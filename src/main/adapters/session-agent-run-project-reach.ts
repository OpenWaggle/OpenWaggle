import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { decodeLocalSessionProfileScope } from '@shared/schemas/local-session-profile'
import * as Effect from 'effect/Effect'
import {
  type RunInitiatorWalk,
  type RunReference,
  type RunVerdictStep,
  walkRunInitiators,
} from '../application/run-initiator-walk'
import {
  durableSessionRunId,
  isLocalUserCallerId,
  isProfileCallerId,
  parseSessionAgentCallerId,
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

/** A caller's own verdict, or the agent Run whose verdict it takes. */
function callerReach(
  sql: SqlClient.SqlClient,
  callerId: string,
): Effect.Effect<boolean | RunReference, unknown> {
  if (isLocalUserCallerId(callerId)) return Effect.succeed(true)
  if (isProfileCallerId(callerId)) {
    return liveProfileScope(sql, callerId).pipe(Effect.map((scope) => scope?.all === true))
  }
  return Effect.succeed(parseSessionAgentCallerId(callerId) ?? false)
}

/** Whether a caller, as the author of input into a Run, reaches every project. */
export function callerReachesEveryProject(sql: SqlClient.SqlClient, callerId: string) {
  return callerReach(sql, callerId).pipe(
    Effect.flatMap((reach) =>
      typeof reach === 'boolean' ? Effect.succeed(reach) : walkRunInitiators(reachWalk(sql), reach),
    ),
  )
}

/**
 * Whether the Session agent acting in this Run reaches every project. Its own authority must
 * (`rootSessionReachesEveryProject`), and so must whoever started the Run: the desktop user, a
 * catalog-wide profile, or another agent whose Run passes this same check. Otherwise a caller
 * limited to one project could message a desktop Session and have it act in every project.
 *
 * Decided from durable rows only, so the Sessions tool and queued Follow-up delivery agree.
 * Unreadable data, and initiator trees spanning more than eight other Sessions or 256 Runs, fail
 * closed.
 */
export function sessionAgentRunReachesEveryProject(
  sql: SqlClient.SqlClient,
  sessionId: string,
  runId: string,
): Effect.Effect<boolean, unknown> {
  return walkRunInitiators(reachWalk(sql), { sessionId, runId })
}

function reachWalk(sql: SqlClient.SqlClient): RunInitiatorWalk<boolean, unknown> {
  return {
    step: (run) => runReachStep(sql, run.sessionId, run.runId),
    combine: (verdicts) => verdicts.every((verdict) => verdict),
    failClosed: false,
  }
}

const NO_REACH: RunVerdictStep<boolean> = { verdict: false, followRuns: [] }

function runReachStep(
  sql: SqlClient.SqlClient,
  sessionId: string,
  runId: string,
): Effect.Effect<RunVerdictStep<boolean>, unknown> {
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
      WHERE session_runs.id = ${durableSessionRunId(runId)}
        AND session_runs.session_id = ${sessionId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row?.initiator_caller_id) return NO_REACH
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
    if (!ownReach) return NO_REACH
    // A re-authorized Follow-up keeps its author, who must reach every project as well.
    const callers = [row.initiator_caller_id, row.author_caller_id].filter(
      (caller): caller is string => caller !== null,
    )
    const followRuns: RunReference[] = []
    for (const caller of callers) {
      const reach = yield* callerReach(sql, caller)
      if (reach === false) return NO_REACH
      if (reach !== true) followRuns.push(reach)
    }
    return { verdict: true, followRuns }
  })
}
