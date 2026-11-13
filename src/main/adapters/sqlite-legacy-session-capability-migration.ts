import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { isLocalUserCallerId } from '@shared/utils/local-user-caller'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import {
  type StoredSessionGrant,
  type StoredSessionGrantSource,
  sessionsHoldingOnlyADefaultGrant,
} from '../domain/session-control/default-grant-restore'
import { createLogger } from '../logger'
import { SCHEDULED_TASK_MIGRATION_ID } from '../services/session-host-schema-identity'

const logger = createLogger('legacy-session-capability-migration')

/** Recorded once the Host has removed the capability lists that only held a default grant. */
export const SESSION_CAPABILITY_GRANTS_RESTORED_KEY = 'sessionCapabilityGrantsRestored'

/** Rows are read and written in pages, so one statement never binds too many ids. */
const PAGE_SIZE = 500

interface StoredGrantRow {
  readonly session_id: string
  readonly created_at: number
  readonly authority_origin_caller_id: string
  /** `$.sessionCapabilities` as JSON text; NULL when the profile is unreadable or has none. */
  readonly capabilities_json: string | null
  /** 1 when the agent definition snapshot names capabilities or cannot be read. */
  readonly definition_chose: number
}

function stringList(json: string | null): readonly string[] | undefined {
  if (json === null) return undefined
  const value = parseJsonUnknown(json)
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string => typeof entry === 'string')
  return strings.length === value.length ? strings : undefined
}

function loadStoredGrants(sql: SqlClient.SqlClient) {
  // CASE evaluates json_* only on valid JSON, so one malformed row cannot fail the restore.
  return sql<StoredGrantRow>`
    SELECT session_id, created_at, authority_origin_caller_id,
      CASE WHEN json_valid(profile_json) THEN
        CASE WHEN json_type(profile_json, '$.sessionCapabilities') = 'array'
          THEN json_extract(profile_json, '$.sessionCapabilities') END
      END AS capabilities_json,
      CASE
        WHEN resolved_agent_snapshot_json IS NULL THEN 0
        WHEN NOT json_valid(resolved_agent_snapshot_json) THEN 1
        WHEN json_type(resolved_agent_snapshot_json, '$.sessionCapabilities') IS NULL THEN 0
        ELSE 1
      END AS definition_chose
    FROM session_execution_profiles
  `.pipe(
    Effect.map((rows) =>
      rows.map(
        (row): StoredSessionGrant => ({
          sessionId: row.session_id,
          createdAt: row.created_at,
          localUserOrigin: isLocalUserCallerId(row.authority_origin_caller_id),
          capabilities: stringList(row.capabilities_json),
          definitionChoseCapabilities: row.definition_chose === 1,
        }),
      ),
    ),
  )
}

function loadGrantSources(sql: SqlClient.SqlClient) {
  return sql<{ readonly session_id: string | null; readonly source_session_id: string | null }>`
    SELECT session_id, substr(caller_id, 15, instr(substr(caller_id, 15), ':') - 1)
      AS source_session_id
    FROM session_agent_origins
    WHERE caller_id LIKE 'session-agent:%:%'
    UNION
    SELECT json_extract(outcome_json, '$.sessionId'), json_extract(outcome_json, '$.sourceSessionId')
    FROM session_operations
    WHERE operation = 'fork' AND status = 'completed'
      AND CASE WHEN json_valid(outcome_json)
        THEN json_extract(outcome_json, '$.effect') END = 'forked-session'
    UNION
    SELECT child_session_id, parent_session_id FROM session_spawn_lineage
  `.pipe(
    Effect.map((rows) =>
      rows.flatMap((row): StoredSessionGrantSource[] =>
        typeof row.session_id === 'string' && typeof row.source_session_id === 'string'
          ? [{ sessionId: row.session_id, sourceSessionId: row.source_session_id }]
          : [],
      ),
    ),
  )
}

/** When Scheduled tasks (migration 70) were installed in this database, if it records that. */
function loadScheduledTasksSince(sql: SqlClient.SqlClient) {
  return sql<{ readonly applied_at: string }>`
    SELECT applied_at FROM _migrations WHERE id = ${SCHEDULED_TASK_MIGRATION_ID}
  `.pipe(
    Effect.map((rows) => {
      const since = rows[0] ? Date.parse(rows[0].applied_at) : Number.NaN
      return Number.isFinite(since) ? since : undefined
    }),
  )
}

/**
 * Removes, once, every persisted `sessionCapabilities` list that only held the default grant of
 * its time, so the Session reads as the current default grant.
 *
 * A list is an allowlist: each Run gets the default grant narrowed to it. Sessions created before
 * Scheduled tasks (1.0.0-beta.23) stored the whole default of that time, and Sessions their agents
 * created, forked or spawned copied it, so their agents never got `schedules:read` or
 * `schedules:manage`. Every Session also stored the whole default after that, which would hide
 * the next capability added to it the same way. New Sessions store no list for the whole default
 * (`callerSessionCapabilityRestriction`). A list an agent definition, an access profile or another
 * client, or a narrower agent chose is a real restriction and stays.
 */
export function restoreSessionCapabilityGrants() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const done = yield* sql<{ readonly key: string }>`
          SELECT key FROM settings_store WHERE key = ${SESSION_CAPABILITY_GRANTS_RESTORED_KEY}
        `
        if (done.length > 0) return 0
        const sessionIds = sessionsHoldingOnlyADefaultGrant({
          grants: yield* loadStoredGrants(sql),
          sources: yield* loadGrantSources(sql),
          scheduledTasksSince: yield* loadScheduledTasksSince(sql),
        })
        const now = Date.now()
        for (let start = 0; start < sessionIds.length; start += PAGE_SIZE) {
          yield* sql`
            UPDATE session_execution_profiles
            SET profile_json = json_remove(profile_json, '$.sessionCapabilities'),
              updated_at = ${now}
            WHERE session_id IN ${sql.in(sessionIds.slice(start, start + PAGE_SIZE))}
          `
        }
        yield* sql`
          INSERT INTO settings_store (key, value_json, updated_at)
          VALUES (${SESSION_CAPABILITY_GRANTS_RESTORED_KEY}, ${'true'}, ${now})
        `
        return sessionIds.length
      }),
    )
  })
}

/**
 * The one-time capability upgrade the Host runs before it serves anyone. It is not a ledger
 * migration, so no migration id fences older binaries out of the database. A failure is logged and
 * leaves the work for the next Host start; it never stops the Host.
 */
export const migrateLegacySessionCapabilityGrants = restoreSessionCapabilityGrants().pipe(
  Effect.tap((restored) =>
    restored > 0
      ? Effect.sync(() =>
          logger.info('Restored the default capability grant of older Sessions', { restored }),
        )
      : Effect.void,
  ),
  Effect.asVoid,
  Effect.catchAllCause((cause) =>
    Effect.sync(() => {
      if (Cause.isInterruptedOnly(cause)) return
      logger.warn(
        'Legacy Session capability migration failed; it will retry at the next Host start',
        { cause: Cause.pretty(cause) },
      )
    }),
  ),
)
