import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import type { Settings } from '@shared/types/settings'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { SettingsStoreReadError } from '../errors'
import { createLogger } from '../logger'
import { collectInitialDefaultWrites } from './settings/initial-default-writes'
import { CURRENT_SETTINGS_KEYS } from './settings/keys'
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

function enqueueSettingsWrite<T>(operation: () => Promise<T>, description: string) {
  const pending = writeQueue.then(operation)
  writeQueue = pending.then(
    () => undefined,
    (error: unknown) => {
      logger.warn('Failed to write setting to SQLite', {
        setting: description,
        error: describeError(error),
      })
    },
  )
  return pending
}

function queueStoredSettingWrite(key: string, value: unknown) {
  return enqueueSettingsWrite(() => writeStoredSettingsToDb([{ key, value }]), key)
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

      for (const write of collectInitialDefaultWrites(storedSettings, built.settings)) {
        void queueStoredSettingWrite(write.key, write.value).catch(() => undefined)
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

/**
 * Reload the durable snapshot so long-lived GUI and detached Session Host
 * processes observe settings written by one another.
 */
export function refreshSettingsStore(): Promise<void> {
  const pending = writeQueue.then(async () => {
    try {
      const storedSettings = await listStoredSettings()
      validatePersistedSettings(storedSettings)
      settingsCache = buildSettingsSnapshot(storedSettings).settings
      settingsReadError = null
      settingsReady = true
    } catch (error) {
      settingsReadError = toSettingsReadError(error)
      settingsReady = false
      initializationPromise = null
      throw settingsReadError
    }
  })
  writeQueue = pending.catch(() => undefined)
  return pending
}

/** Install the authoritative Host snapshot without writing to the attached GUI's isolated DB. */
export function hydrateSettingsStoreFromHost(snapshot: unknown): void {
  if (!isRecord(snapshot)) throw new Error('Session Host returned an invalid settings snapshot.')
  for (const key of CURRENT_SETTINGS_KEYS) {
    if (!Object.hasOwn(snapshot, key) || snapshot[key] === undefined) {
      throw new SettingsStoreReadError({
        operation: 'decode',
        key,
        message: `Session Host returned an incomplete settings snapshot: ${key}.`,
      })
    }
  }
  validatePersistedSettings(snapshot)
  settingsCache = buildSettingsSnapshot(snapshot).settings
  settingsReadError = null
  settingsReady = true
  initializationPromise ??= Promise.resolve()
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
    void queueStoredSettingWrite(write.key, write.value).catch(() => undefined)
  }

  const invalidThinkingLevel = getInvalidThinkingLevel(partial)
  if (invalidThinkingLevel !== undefined) {
    logger.warn('Skipping invalid thinkingLevel', { value: invalidThinkingLevel })
  }
}

export function updateSkillToggleDurably(
  projectPath: string,
  skillId: string,
  enabled: boolean,
): Promise<void> {
  assertSettingsReady()
  return enqueueSettingsWrite(
    () =>
      persistSettingsPatch({
        skillTogglesByProject: {
          ...settingsCache.skillTogglesByProject,
          [projectPath]: {
            ...(settingsCache.skillTogglesByProject[projectPath] ?? {}),
            [skillId]: enabled,
          },
        },
      }),
    'skill toggle',
  )
}

export function updateAgentDefinitionToggleDurably(
  projectPath: string,
  agentName: string,
  enabled: boolean,
): Promise<void> {
  assertSettingsReady()
  return enqueueSettingsWrite(
    () =>
      persistSettingsPatch({
        agentDefinitionTogglesByProject: {
          ...settingsCache.agentDefinitionTogglesByProject,
          [projectPath]: {
            ...(settingsCache.agentDefinitionTogglesByProject[projectPath] ?? {}),
            [agentName]: enabled,
          },
        },
      }),
    'Agent definition toggle',
  )
}

/**
 * Sets or clears one project's selected model inside the write queue, so concurrent writes cannot
 * lose map entries. The model lives only in the app DB, never in the repo-local settings file.
 */
export function updateSelectedModelDurably(
  projectPath: string,
  model: string | null,
): Promise<void> {
  assertSettingsReady()
  return enqueueSettingsWrite(() => {
    const { [projectPath]: _removed, ...rest } = settingsCache.selectedModelsByProject
    return persistSettingsPatch({
      selectedModelsByProject: model === null ? rest : { ...rest, [projectPath]: model },
    })
  }, 'project model')
}

/**
 * Inserts one project's legacy selected model into the DB only while no entry exists. Runs inside
 * the write queue, so a concurrent explicit model write can never be overwritten by the stale
 * legacy value; returns whether the migration inserted anything.
 */
export function migrateSelectedModelDurably(projectPath: string, model: string): Promise<boolean> {
  assertSettingsReady()
  return enqueueSettingsWrite(async () => {
    if (Object.hasOwn(settingsCache.selectedModelsByProject, projectPath)) return false
    await persistSettingsPatch({
      selectedModelsByProject: { ...settingsCache.selectedModelsByProject, [projectPath]: model },
    })
    return true
  }, 'project model migration')
}

/**
 * Persists one settings patch in queue order before publishing it to readers.
 * Reserved for workflows whose rollback depends on knowing the new identity is
 * durable, such as publishing a browser profile after its cookies are written.
 */
export function updateSettingsDurably(partial: Partial<Settings>): Promise<void> {
  assertSettingsReady()
  return enqueueSettingsWrite(() => persistSettingsPatch(partial), 'durable settings patch')
}

async function persistSettingsPatch(partial: Partial<Settings>): Promise<void> {
  assertSettingsReady()
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
}
