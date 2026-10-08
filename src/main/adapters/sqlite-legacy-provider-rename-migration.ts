import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import {
  LEGACY_PROVIDER_RENAMES,
  renameLegacyProviderModelReference,
} from '../domain/legacy-provider-renames'
import { createLogger } from '../logger'
import {
  SETTINGS_KEY_DEFAULT_MODEL,
  SETTINGS_KEY_ENABLED_MODELS,
  SETTINGS_KEY_FAVORITE_MODELS,
  SETTINGS_KEY_SELECTED_MODELS_BY_PROJECT,
  SETTINGS_KEY_SESSION_TITLE_MODEL,
} from '../store/settings/keys'

const logger = createLogger('legacy-provider-rename-migration')

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
    let renamed = 0
    for (const [legacyId, providerId] of LEGACY_PROVIDER_RENAMES) {
      // Only profiles that name an old provider id are read, as this runs at every Host start.
      const prefix = `${legacyId}/`
      const rows = yield* sql<{ readonly session_id: string; readonly model_id: string }>`
        SELECT session_id, json_extract(profile_json, '$.modelId') AS model_id
        FROM session_execution_profiles
        WHERE json_valid(profile_json)
          AND substr(json_extract(profile_json, '$.modelId'), 1, ${prefix.length}) = ${prefix}
      `
      for (const row of rows) {
        const modelId = `${providerId}/${row.model_id.slice(prefix.length)}`
        yield* sql`
          UPDATE session_execution_profiles
          SET profile_json = json_set(profile_json, '$.modelId', ${modelId}), updated_at = ${now}
          WHERE session_id = ${row.session_id}
        `
        renamed += 1
      }
    }
    return renamed
  })
}

/**
 * Moves every `provider/modelId` reference OpenWaggle stores in SQLite to the provider ids Pi
 * renamed (Pi 1.0.3: `azure-openai-responses` became `azure`), so a user's model choices and
 * existing OpenWaggle Session profiles keep their model after the upgrade. It runs at every Host
 * start and keeps no marker, so references an older OpenWaggle writes after a downgrade move
 * again on the next upgrade; with nothing to move it writes nothing. A failure is logged and
 * retried at the next Host start; it never stops the Host.
 */
export const migrateLegacyProviderReferences = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const now = Date.now()
  const renamed = yield* sql.withTransaction(
    Effect.gen(function* () {
      const settings = yield* renameSettingReferences(sql, now)
      const profiles = yield* renameProfileReferences(sql, now)
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
