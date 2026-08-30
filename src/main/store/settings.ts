import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import type { Settings } from '@shared/types/settings'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { SETTINGS_KEY_DEFAULT_MODEL } from './settings/keys'
import { collectSettingsPatchWrites, getInvalidThinkingLevel } from './settings/persistence-plan'
import {
  buildNextSettingsSnapshot,
  buildSettingsSnapshot,
  createDefaultSettingsSnapshot,
} from './settings/snapshot'
import { runStoreEffect } from './store-runtime'

const logger = createLogger('settings')

interface SettingsStoreRow {
  readonly key: string
  readonly value_json: string
}

let settingsCache = createDefaultSettingsSnapshot()
let initializationPromise: Promise<void> | null = null
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
    try {
      stored[row.key] = parseJsonUnknown(row.value_json)
    } catch (error) {
      logger.warn('Failed to parse stored setting JSON', {
        key: row.key,
        error: describeError(error),
      })
    }
  }
  return stored
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

function queueStoredSettingWrite(key: string, value: unknown) {
  const operation = writeQueue.then(() => writeStoredSettingToDb(key, value))
  writeQueue = operation.catch((error) => {
    logger.warn('Failed to write setting to SQLite', { key, error: describeError(error) })
  })
  return operation
}

export async function initializeSettingsStore(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise
  }

  initializationPromise = (async () => {
    try {
      const storedSettings = await listStoredSettings()
      const built = buildSettingsSnapshot(storedSettings)
      settingsCache = built.settings

      if (built.settings.selectedModel !== storedSettings[SETTINGS_KEY_DEFAULT_MODEL]) {
        queueStoredSettingWrite(SETTINGS_KEY_DEFAULT_MODEL, built.settings.selectedModel)
      }
    } catch (error) {
      logger.warn('Failed to initialize settings cache from SQLite', {
        error: describeError(error),
      })
      settingsCache = createDefaultSettingsSnapshot()
    }
  })()

  await initializationPromise
}

/**
 * Reload the durable snapshot so long-lived GUI and detached Session Host
 * processes observe settings written by one another.
 */
export async function refreshSettingsStore(): Promise<void> {
  await writeQueue
  const storedSettings = await listStoredSettings()
  settingsCache = buildSettingsSnapshot(storedSettings).settings
}

/** Install the authoritative Host snapshot without writing to the attached GUI's isolated DB. */
export function hydrateSettingsStoreFromHost(snapshot: unknown): void {
  if (!isRecord(snapshot)) throw new Error('Session Host returned an invalid settings snapshot.')
  settingsCache = buildSettingsSnapshot(snapshot).settings
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
  settingsCache = createDefaultSettingsSnapshot()
}

export function getSettings(): Settings {
  return settingsCache
}

function applySettingsUpdate(partial: Partial<Settings>) {
  const nextSettings = buildNextSettingsSnapshot(settingsCache, partial)
  settingsCache = nextSettings

  const writes = collectSettingsPatchWrites(partial, nextSettings).map((write) =>
    queueStoredSettingWrite(write.key, write.value),
  )

  const invalidThinkingLevel = getInvalidThinkingLevel(partial)
  if (invalidThinkingLevel !== undefined) {
    logger.warn('Skipping invalid thinkingLevel', { value: invalidThinkingLevel })
  }
  return writes
}

export function updateSettings(partial: Partial<Settings>): void {
  applySettingsUpdate(partial)
}

export async function updateSettingsDurably(partial: Partial<Settings>): Promise<void> {
  await Promise.all(applySettingsUpdate(partial))
}

export async function updateSkillToggleDurably(
  projectPath: string,
  skillId: string,
  enabled: boolean,
): Promise<void> {
  const projectToggles = {
    ...(settingsCache.skillTogglesByProject[projectPath] ?? {}),
    [skillId]: enabled,
  }
  await updateSettingsDurably({
    skillTogglesByProject: {
      ...settingsCache.skillTogglesByProject,
      [projectPath]: projectToggles,
    },
  })
}
