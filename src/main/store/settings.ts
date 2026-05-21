import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import type { Settings } from '@shared/types/settings'
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
  writeQueue = writeQueue
    .then(() => writeStoredSettingToDb(key, value))
    .catch((error) => {
      logger.warn('Failed to write setting to SQLite', { key, error: describeError(error) })
    })
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

export async function flushSettingsStoreForTests(): Promise<void> {
  await writeQueue
}

export function getSettings(): Settings {
  return settingsCache
}

export function updateSettings(partial: Partial<Settings>): void {
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
