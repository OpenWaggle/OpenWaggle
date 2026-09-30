import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { decodeLocalSessionProfileScope } from '@shared/schemas/local-session-profile'
import * as Effect from 'effect/Effect'
import {
  isLocalUserCallerId,
  isProfileCallerId,
  MAX_RUN_INITIATOR_CHAIN_DEPTH,
  parseSessionAgentCallerId,
  requestedWaggleClassicRunId,
  rootSessionReachesEveryProject,
} from '../domain/session-control/root-session-project-reach'
import { decodeSessionAuthoritySnapshot } from '../session-host/session-authority-snapshot'

interface RunSourceRow {
  readonly initiator_caller_id: string | null
  readonly author_caller_id: string | null
  readonly authority_origin_caller_id: string
  readonly authority_scope_snapshot_json: string | null
  readonly parent_session_id: string | null
  readonly profile_scope_json: string | null
  readonly profile_revoked_at: number | null
}

function liveProfileScope(sql: SqlClient.SqlClient, callerId: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly scope_json: string; readonly revoked_at: number | null }>`
      SELECT scope_json, revoked_at FROM session_client_profiles
      WHERE id = ${callerId.slice('profile:'.length)}
      LIMIT 1
    `
    const profile = rows[0]
    if (!profile || profile.revoked_at !== null) return undefined
    // An unreadable scope fails closed: no reach, rather than a defect that ends the Run.
    return yield* Effect.try(() =>
      decodeLocalSessionProfileScope(parseJsonUnknown(profile.scope_json)),
    ).pipe(Effect.orElseSucceed(() => undefined))
  })
}

/** Whether a caller, as the author of input into a Run, reaches every project. */
export function callerReachesEveryProject(sql: SqlClient.SqlClient, callerId: string) {
  return initiatorReachesEveryProject(sql, callerId, 0)
}

function initiatorReachesEveryProject(
  sql: SqlClient.SqlClient,
  callerId: string,
  depth: number,
): Effect.Effect<boolean, unknown> {
  if (isLocalUserCallerId(callerId)) return Effect.succeed(true)
  if (isProfileCallerId(callerId)) {
    return liveProfileScope(sql, callerId).pipe(Effect.map((scope) => scope?.all === true))
  }
  const agent = parseSessionAgentCallerId(callerId)
  if (!agent) return Effect.succeed(false)
  return sessionAgentRunReachesEveryProject(sql, agent.sessionId, agent.runId, depth + 1)
}

/**
 * Whether the Session agent acting in this Run reaches every project. Its own authority must
 * (`rootSessionReachesEveryProject`), and so must whoever started the Run: the desktop user, a
 * catalog-wide profile, or another agent whose Run passes this same check. Otherwise a caller
 * limited to one project could message a desktop Session and have it act in every project.
 *
 * Decided from durable rows only, so the Sessions tool and queued Follow-up delivery agree.
 * Unreadable data and chains longer than eight agents fail closed.
 */
export function sessionAgentRunReachesEveryProject(
  sql: SqlClient.SqlClient,
  sessionId: string,
  runId: string,
  depth = 0,
): Effect.Effect<boolean, unknown> {
  if (depth > MAX_RUN_INITIATOR_CHAIN_DEPTH) return Effect.succeed(false)
  return Effect.gen(function* () {
    const rows = yield* sql<RunSourceRow>`
      SELECT json_extract(session_runs.intent_json, '$.callerId') AS initiator_caller_id,
        json_extract(session_runs.intent_json, '$.authorCallerId') AS author_caller_id,
        session_execution_profiles.authority_origin_caller_id,
        session_execution_profiles.authority_scope_snapshot_json,
        COALESCE(session_spawn_lineage.parent_session_id, session_lineage.parent_session_id)
          AS parent_session_id,
        session_client_profiles.scope_json AS profile_scope_json,
        session_client_profiles.revoked_at AS profile_revoked_at
      FROM session_runs
      JOIN session_execution_profiles
        ON session_execution_profiles.session_id = session_runs.session_id
      LEFT JOIN session_spawn_lineage
        ON session_spawn_lineage.child_session_id = session_runs.session_id
      LEFT JOIN session_lineage ON session_lineage.session_id = session_runs.session_id
      LEFT JOIN session_client_profiles
        ON session_execution_profiles.authority_origin_caller_id =
          ${'profile:'} || session_client_profiles.id
      WHERE session_runs.id = ${requestedWaggleClassicRunId(runId) ?? runId}
        AND session_runs.session_id = ${sessionId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row?.initiator_caller_id) return false
    const ownReach = yield* Effect.try(() =>
      rootSessionReachesEveryProject({
        isRoot: row.parent_session_id === null,
        originCallerId: row.authority_origin_caller_id,
        liveProfileScope:
          row.profile_scope_json && row.profile_revoked_at === null
            ? decodeLocalSessionProfileScope(parseJsonUnknown(row.profile_scope_json))
            : undefined,
        snapshotScope: decodeSessionAuthoritySnapshot(row.authority_scope_snapshot_json)?.scope,
      }),
    ).pipe(Effect.orElseSucceed(() => false))
    if (!ownReach) return false
    if (!(yield* initiatorReachesEveryProject(sql, row.initiator_caller_id, depth))) return false
    // A re-authorized Follow-up keeps its author, who must reach every project as well.
    return row.author_caller_id === null
      ? true
      : yield* initiatorReachesEveryProject(sql, row.author_caller_id, depth)
  })
}
