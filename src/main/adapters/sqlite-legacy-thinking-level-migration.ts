import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { THINKING_LEVELS, type ThinkingLevel } from '@shared/types/settings'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { ThinkingLevelDefaultService } from '../ports/thinking-level-default-service'

const logger = createLogger('legacy-thinking-level-migration')

/** Where beta.5 kept the desktop user's composer pick, as app state rather than Pi's default. */
const LEGACY_DESKTOP_THINKING_LEVEL_KEY = 'thinkingLevel'
/** Recorded once every Session's thinking level has been restored from its Pi entries. */
export const SESSION_THINKING_LEVELS_RESTORED_KEY = 'sessionThinkingLevelsRestored'

function thinkingLevel(value: unknown): ThinkingLevel | undefined {
  return THINKING_LEVELS.find((level) => level === value)
}

function storedSettingValue(valueJson: string) {
  try {
    return parseJsonUnknown(valueJson)
  } catch (error) {
    logger.warn('Dropping an unreadable legacy desktop thinking level', {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/**
 * Moves beta.5's desktop pick (`settings_store.thinkingLevel`) into Pi's global default when Pi
 * names none, and returns it (undefined when there is none or it is not a level). The key is kept:
 * the Session restore reads the pick too, and `deleteLegacyDesktopThinkingLevel` drops it once both
 * are done, so a failed write or restore is retried at the next Host start.
 */
function moveLegacyDesktopThinkingLevel() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly value_json: string }>`
      SELECT value_json FROM settings_store WHERE key = ${LEGACY_DESKTOP_THINKING_LEVEL_KEY}
    `
    const row = rows[0]
    if (!row) return undefined
    const level = thinkingLevel(storedSettingValue(row.value_json))
    if (!level) return undefined
    const defaults = yield* ThinkingLevelDefaultService
    if ((yield* defaults.getConfiguredDefault()) === undefined) {
      yield* defaults.setDefault(level)
      logger.info("Moved the desktop thinking level into Pi's global default", { level })
    }
    return level
  })
}

function deleteLegacyDesktopThinkingLevel() {
  return SqlClient.SqlClient.pipe(
    Effect.flatMap(
      (sql) => sql`DELETE FROM settings_store WHERE key = ${LEGACY_DESKTOP_THINKING_LEVEL_KEY}`,
    ),
  )
}

interface SessionThinkingLevelRow {
  readonly session_id: string
  readonly stored_level: unknown
  /** The last `thinking_level_change` on the Session's active path, as Pi restores it. */
  readonly restored_level: unknown
}

/**
 * Each Session with an execution profile, its stored level, and the level Pi would restore from its
 * entries: the last `thinking_level_change` on the path from its active node (or, without one, its
 * newest node, which is where Pi opens the file) back to the root.
 */
function loadSessionThinkingLevels(sql: SqlClient.SqlClient) {
  return sql<SessionThinkingLevelRow>`
    WITH RECURSIVE heads(session_id, node_id) AS (
      SELECT profiles.session_id, COALESCE(
        sessions.last_active_node_id,
        (SELECT newest.id FROM session_nodes AS newest
          WHERE newest.session_id = profiles.session_id
          ORDER BY newest.created_order DESC LIMIT 1)
      )
      FROM session_execution_profiles AS profiles
      JOIN sessions ON sessions.id = profiles.session_id
      WHERE json_valid(profiles.profile_json)
    ), active_path(session_id, node_id) AS (
      SELECT session_id, node_id FROM heads WHERE node_id IS NOT NULL
      UNION ALL
      SELECT active_path.session_id, nodes.parent_id
      FROM active_path
      JOIN session_nodes AS nodes ON nodes.id = active_path.node_id
      WHERE nodes.parent_id IS NOT NULL
    ), changes(session_id, level, rank) AS (
      SELECT active_path.session_id,
        json_extract(nodes.content_json, '$.thinkingLevel'),
        ROW_NUMBER() OVER (
          PARTITION BY active_path.session_id ORDER BY nodes.path_depth DESC
        )
      FROM active_path
      JOIN session_nodes AS nodes ON nodes.id = active_path.node_id
      WHERE nodes.kind = 'thinking_level_change' AND json_valid(nodes.content_json)
    )
    SELECT profiles.session_id,
      json_extract(profiles.profile_json, '$.thinkingLevel') AS stored_level,
      changes.level AS restored_level
    FROM session_execution_profiles AS profiles
    LEFT JOIN changes ON changes.session_id = profiles.session_id AND changes.rank = 1
    WHERE json_valid(profiles.profile_json)
  `
}

const OFF_RANK = THINKING_LEVELS.indexOf('off')

/**
 * The level a Session keeps: the one Pi restores from its entries, else its stored level, else
 * Pi's default.
 *
 * Pi records a level after clamping it to the model, so a Session that ran on a model without
 * reasoning recorded `off` whatever the user picked. Restoring that `off` would lose the pick when
 * the Session later switches to a reasoning model (a Run clamps the stored level to its model
 * anyway, so keeping the pick changes nothing while the model has no reasoning). So when the
 * restored level is `off` and the legacy level is higher, the legacy level wins: beta.5's desktop
 * pick, which every desktop message carried, or, without one, the Session's stored level. A known
 * desktop pick of `off` keeps `off`, since that is what the user chose.
 */
function sessionLevel(
  row: SessionThinkingLevelRow,
  legacyDesktopLevel: ThinkingLevel | undefined,
  fallback: ThinkingLevel,
): ThinkingLevel {
  const restored = thinkingLevel(row.restored_level)
  const stored = thinkingLevel(row.stored_level)
  if (restored !== 'off') return restored ?? stored ?? fallback
  const legacy = legacyDesktopLevel ?? stored
  return legacy && THINKING_LEVELS.indexOf(legacy) > OFF_RANK ? legacy : restored
}

/**
 * Makes every existing Session's stored thinking level the one it actually runs with, once.
 *
 * Before the Session thinking level, a Run used the level its message carried, and Pi recorded it
 * as a `thinking_level_change` entry; the level stored in the execution profile was written at
 * creation and never shown. Pi restores a Session's last entry when no level is passed, but now
 * every Run passes the stored level, so the stored level must be the restored one or the Session
 * would switch levels silently on its next Run. A Session with no entry keeps its stored level,
 * and one with neither gets Pi's global default, which is what the UI showed for it.
 * `legacyDesktopLevel` is beta.5's desktop pick, if any (see `sessionLevel`).
 */
export function restoreSessionThinkingLevels(legacyDesktopLevel: ThinkingLevel | undefined) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const done = yield* sql<{ readonly key: string }>`
      SELECT key FROM settings_store WHERE key = ${SESSION_THINKING_LEVELS_RESTORED_KEY}
    `
    if (done.length > 0) return 0
    const fallback = yield* (yield* ThinkingLevelDefaultService).getDefault()
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const rows = yield* loadSessionThinkingLevels(sql)
        const now = Date.now()
        let restored = 0
        for (const row of rows) {
          const level = sessionLevel(row, legacyDesktopLevel, fallback)
          if (level === row.stored_level) continue
          yield* sql`
            UPDATE session_execution_profiles
            SET profile_json = json_set(profile_json, '$.thinkingLevel', ${level}),
              updated_at = ${now}
            WHERE session_id = ${row.session_id}
          `
          restored += 1
        }
        yield* sql`
          INSERT INTO settings_store (key, value_json, updated_at)
          VALUES (${SESSION_THINKING_LEVELS_RESTORED_KEY}, ${'true'}, ${now})
        `
        return restored
      }),
    )
  })
}

/**
 * The one-time thinking-level upgrade the Host runs before it serves anyone: beta.5's desktop pick
 * becomes Pi's default first, so a Session with no level of its own gets that default, and it
 * replaces a restored `off` that only records a clamp (`sessionLevel`). The pick is deleted last.
 * A failure is logged and leaves the work for the next Host start; it never stops the Host.
 */
export const migrateLegacyThinkingLevels = Effect.gen(function* () {
  const legacyDesktopLevel = yield* moveLegacyDesktopThinkingLevel()
  const restored = yield* restoreSessionThinkingLevels(legacyDesktopLevel)
  yield* deleteLegacyDesktopThinkingLevel()
  if (restored > 0) {
    logger.info('Restored Session thinking levels from their Pi entries', { restored })
  }
}).pipe(
  Effect.catchAllCause((cause) =>
    Effect.sync(() => {
      if (Cause.isInterruptedOnly(cause)) return
      logger.warn('Legacy thinking level migration failed; it will retry at the next Host start', {
        cause: Cause.pretty(cause),
      })
    }),
  ),
)
