import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import type { Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { SettingsStoreReadError } from '../errors'
import { createLogger } from '../logger'
import { CURRENT_SETTINGS_KEYS, SETTINGS_KEY_DEFAULT_MODEL } from './settings/keys'
import { validatePersistedSettings } from './settings/persisted-validation'
import {
  collectSettingsPatchWrites,
  getInvalidThinkingLevel,
  type SettingsPatchWrite,
} from './settings/persistence-plan'
import {
  buildNextSettingsSnapshot,
  buildSettingsSnapshot,
  createDefaultSettingsSnapshot,
} from './settings/snapshot'
import { runStoreEffect } from './store-runtime'

const logger = createLogger('settings')
const currentSettingsKeys = new Set<string>(CURRENT_SETTINGS_KEYS)

interface SettingsStoreRow {
  readonly key: string
  readonly value_json: string
}

let settingsCache = createDefaultSettingsSnapshot()
let initializationPromise: Promise<void> | null = null
let settingsReadError: SettingsStoreReadError | null = null
let settingsReady = false
let writeQueue: Promise<void> = Promise.resolve()

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function listStoredSettings() {
  const rows = await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<SettingsStoreRow>`
        SELECT key, value_json
        FROM settings_store
      `
    }),
  )

  const stored: Record<string, unknown> = {}
  for (const row of rows) {
    if (!currentSettingsKeys.has(row.key)) continue
    try {
      stored[row.key] = parseJsonUnknown(row.value_json)
    } catch (error) {
      throw new SettingsStoreReadError({
        operation: 'decode',
        key: row.key,
        message: `Saved setting "${row.key}" is not valid JSON.`,
        cause: error,
      })
    }
  }
  return stored
}

function toSettingsReadError(error: unknown) {
  return error instanceof SettingsStoreReadError
    ? error
    : new SettingsStoreReadError({
        operation: 'read',
        message: 'OpenWaggle could not read the saved settings database.',
        cause: error,
      })
}

function assertSettingsReady() {
  if (settingsReady) return
  throw (
    settingsReadError ??
    new SettingsStoreReadError({
      operation: 'read',
      message: 'OpenWaggle settings have not finished loading.',
    })
  )
}

async function writeStoredSettingToDb(key: string, value: unknown) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO settings_store (key, value_json, updated_at)
        VALUES (${key}, ${JSON.stringify(value)}, ${Date.now()})
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `
    }),
  )
}

async function writeStoredSettingsToDb(writes: readonly SettingsPatchWrite[]) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(
        Effect.forEach(
          writes,
          (write) => sql`
            INSERT INTO settings_store (key, value_json, updated_at)
            VALUES (${write.key}, ${JSON.stringify(write.value)}, ${Date.now()})
            ON CONFLICT(key) DO UPDATE SET
              value_json = excluded.value_json,
              updated_at = excluded.updated_at
          `,
          { discard: true },
        ),
      )
    }),
  )
}

function enqueueSettingsWrite(operation: () => Promise<void>, description: string) {
  const pending = writeQueue.then(operation)
  writeQueue = pending.catch((error) => {
    logger.warn('Failed to write setting to SQLite', {
      setting: description,
      error: describeError(error),
    })
  })
  return pending
}

function queueStoredSettingWrite(key: string, value: unknown) {
  void enqueueSettingsWrite(() => writeStoredSettingToDb(key, value), key)
}

export async function initializeSettingsStore(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise
  }

  if (settingsReady) return

  const attempt = (async () => {
    try {
      const storedSettings = await listStoredSettings()
      validatePersistedSettings(storedSettings)
      const built = buildSettingsSnapshot(storedSettings)
      settingsCache = built.settings
      settingsReadError = null
      settingsReady = true

      if (built.settings.selectedModel !== storedSettings[SETTINGS_KEY_DEFAULT_MODEL]) {
        queueStoredSettingWrite(SETTINGS_KEY_DEFAULT_MODEL, built.settings.selectedModel)
      }
    } catch (error) {
      settingsReadError = toSettingsReadError(error)
      settingsReady = false
      logger.error('Failed to initialize settings cache from SQLite', {
        operation: settingsReadError.operation,
        key: settingsReadError.key,
        error: settingsReadError.message,
        cause: describeError(settingsReadError.cause),
      })
    }
  })()
  initializationPromise = attempt

  await attempt
  if (!settingsReady && initializationPromise === attempt) initializationPromise = null
}

export async function flushSettingsStoreForTests(): Promise<void> {
  await writeQueue
}

/**
 * Clear the module-level cache and its idempotence guard so a test can re-read a
 * fresh database through `initializeSettingsStore()`.
 *
 * Exists so tests do not need `vi.resetModules()` to get a clean cache. Resetting
 * the module registry also replaced the app runtime module, which orphaned a live
 * better-sqlite3 Database per test inside a worker vitest reuses across files, and
 * that accumulation crashed the addon at teardown (#151).
 */
export async function resetSettingsStoreForTests(): Promise<void> {
  await writeQueue
  initializationPromise = null
  settingsReadError = null
  settingsReady = false
  settingsCache = createDefaultSettingsSnapshot()
}

export function getSettings(): Settings {
  assertSettingsReady()
  return settingsCache
}

export function updateSettings(partial: Partial<Settings>): void {
  assertSettingsReady()
  const nextSettings = buildNextSettingsSnapshot(settingsCache, partial)
  settingsCache = nextSettings

  for (const write of collectSettingsPatchWrites(partial, nextSettings)) {
    queueStoredSettingWrite(write.key, write.value)
  }

  const invalidThinkingLevel = getInvalidThinkingLevel(partial)
  if (invalidThinkingLevel !== undefined) {
    logger.warn('Skipping invalid thinkingLevel', { value: invalidThinkingLevel })
  }
}

/**
 * Persists one settings patch in queue order before publishing it to readers.
 * Reserved for workflows whose rollback depends on knowing the new identity is
 * durable, such as publishing a browser profile after its cookies are written.
 */
export function updateSettingsDurably(partial: Partial<Settings>): Promise<void> {
  assertSettingsReady()
  return enqueueSettingsWrite(async () => {
    const nextSettings = buildNextSettingsSnapshot(settingsCache, partial)
    const writes = collectSettingsPatchWrites(partial, nextSettings)
    await writeStoredSettingsToDb(writes)
    // A normal settings update may have changed another field while SQLite was
    // writing. Re-apply only this patch to the latest cache instead of
    // publishing the older full snapshot.
    settingsCache = buildNextSettingsSnapshot(settingsCache, partial)

    const invalidThinkingLevel = getInvalidThinkingLevel(partial)
    if (invalidThinkingLevel !== undefined) {
      logger.warn('Skipping invalid thinkingLevel', { value: invalidThinkingLevel })
    }
  }, 'durable settings patch')
}
