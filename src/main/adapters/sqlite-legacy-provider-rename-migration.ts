import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import {
  SETTINGS_KEY_DEFAULT_MODEL,
  SETTINGS_KEY_ENABLED_MODELS,
  SETTINGS_KEY_FAVORITE_MODELS,
  SETTINGS_KEY_SELECTED_MODELS_BY_PROJECT,
  SETTINGS_KEY_SESSION_TITLE_MODEL,
} from '../store/settings/keys'
import { renameLegacyProviderModelReference } from './pi/pi-provider-renames'

const logger = createLogger('legacy-provider-rename-migration')

/** Recorded once stored model references have been moved to Pi 1.0.3's renamed provider ids. */
export const LEGACY_PROVIDER_REFERENCES_RENAMED_KEY = 'legacyProviderReferencesRenamed'

/** Settings whose values are `provider/modelId` references, alone, in a list, or keyed by project. */
const MODEL_REFERENCE_SETTING_KEYS = [
  SETTINGS_KEY_DEFAULT_MODEL,
  SETTINGS_KEY_FAVORITE_MODELS,
  SETTINGS_KEY_ENABLED_MODELS,
  SETTINGS_KEY_SELECTED_MODELS_BY_PROJECT,
  SETTINGS_KEY_SESSION_TITLE_MODEL,
] as const

function renamedReferences(value: unknown): unknown {
  if (typeof value === 'string') return renameLegacyProviderModelReference(value)
  if (Array.isArray(value)) return value.map(renamedReferences)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, renamedReferences(entry)]),
    )
  }
  return value
}

function storedValue(key: string, valueJson: string) {
  try {
    return { value: parseJsonUnknown(valueJson) }
  } catch (error) {
    logger.warn('Leaving an unreadable model setting unchanged', {
      key,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

function renameSettingReferences(sql: SqlClient.SqlClient, now: number) {
  return Effect.gen(function* () {
    let renamed = 0
    for (const key of MODEL_REFERENCE_SETTING_KEYS) {
      const rows = yield* sql<{ readonly value_json: string }>`
        SELECT value_json FROM settings_store WHERE key = ${key}
      `
      const row = rows[0]
      if (!row) continue
      const stored = storedValue(key, row.value_json)
      if (!stored) continue
      const nextJson = JSON.stringify(renamedReferences(stored.value))
      if (nextJson === JSON.stringify(stored.value)) continue
      yield* sql`
        UPDATE settings_store SET value_json = ${nextJson}, updated_at = ${now} WHERE key = ${key}
      `
      renamed += 1
    }
    return renamed
  })
}

function renameProfileReferences(sql: SqlClient.SqlClient, now: number) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly session_id: string; readonly model_id: unknown }>`
      SELECT session_id, json_extract(profile_json, '$.modelId') AS model_id
      FROM session_execution_profiles
      WHERE json_valid(profile_json)
    `
    let renamed = 0
    for (const row of rows) {
      if (typeof row.model_id !== 'string') continue
      const modelId = renameLegacyProviderModelReference(row.model_id)
      if (modelId === row.model_id) continue
      yield* sql`
        UPDATE session_execution_profiles
        SET profile_json = json_set(profile_json, '$.modelId', ${modelId}), updated_at = ${now}
        WHERE session_id = ${row.session_id}
      `
      renamed += 1
    }
    return renamed
  })
}

/**
 * Moves every `provider/modelId` reference OpenWaggle stores in SQLite to the provider ids Pi
 * renamed (Pi 1.0.3: `azure-openai-responses` became `azure`), once, so a user's model choices and
 * existing Sessions keep their model after the upgrade. A failure is logged and retried at the
 * next Host start; it never stops the Host.
 */
export const migrateLegacyProviderReferences = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const done = yield* sql<{ readonly key: string }>`
    SELECT key FROM settings_store WHERE key = ${LEGACY_PROVIDER_REFERENCES_RENAMED_KEY}
  `
  if (done.length > 0) return
  const now = Date.now()
  const renamed = yield* sql.withTransaction(
    Effect.gen(function* () {
      const settings = yield* renameSettingReferences(sql, now)
      const profiles = yield* renameProfileReferences(sql, now)
      yield* sql`
        INSERT INTO settings_store (key, value_json, updated_at)
        VALUES (${LEGACY_PROVIDER_REFERENCES_RENAMED_KEY}, ${'true'}, ${now})
      `
      return { settings, profiles }
    }),
  )
  if (renamed.settings > 0 || renamed.profiles > 0) {
    logger.info('Moved stored model references to renamed Pi providers', renamed)
  }
}).pipe(
  Effect.catchAllCause((cause) =>
    Effect.sync(() => {
      if (Cause.isInterruptedOnly(cause)) return
      logger.warn('Legacy provider rename migration failed; it will retry at the next Host start', {
        cause: Cause.pretty(cause),
      })
    }),
  ),
)
