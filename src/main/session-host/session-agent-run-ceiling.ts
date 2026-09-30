import type * as SqlClient from '@effect/sql/SqlClient'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import * as Effect from 'effect/Effect'
import {
  isLocalUserCallerId,
  isProfileCallerId,
  MAX_RUN_INITIATOR_CHAIN_DEPTH,
  parseSessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'

const ASK: AgentAuthorizationMode = 'ask-for-approval'
const YOLO: AgentAuthorizationMode = 'yolo'

function narrower(modes: readonly AgentAuthorizationMode[]) {
  return modes.includes(ASK) ? ASK : YOLO
}

interface InitiatorRow {
  readonly initiator_caller_id: string | null
  readonly author_caller_id: string | null
}

export interface SessionAuthorizationBoundary {
  readonly authorizationCeiling: AgentAuthorizationMode
  readonly revoked: boolean
}

/**
 * A Session agent's own Authorization boundary: its Session's ceiling, its Worker grant, and the
 * live ceiling of the CLI profile it came from. A missing Worker grant, or a revoked grant or
 * profile, counts as revoked. The Run-mode boundary and the Sessions tool both use this, so a
 * downgraded or revoked origin profile narrows both at once.
 */
export function sessionAgentAuthorizationBoundary(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{
      readonly execution_ceiling: AgentAuthorizationMode
      readonly grant_ceiling: AgentAuthorizationMode | null
      readonly grant_revoked_at: number | null
      readonly parent_session_id: string | null
      readonly profile_ceiling: AgentAuthorizationMode | null
      readonly profile_revoked_at: number | null
    }>`
      SELECT execution.authorization_ceiling AS execution_ceiling,
        COALESCE(lineage.parent_session_id, historical.parent_session_id)
          AS parent_session_id,
        grants.authorization_ceiling AS grant_ceiling,
        grants.revoked_at AS grant_revoked_at,
        profiles.authorization_ceiling AS profile_ceiling,
        profiles.revoked_at AS profile_revoked_at
      FROM session_execution_profiles AS execution
      LEFT JOIN session_spawn_lineage AS lineage
        ON lineage.child_session_id = execution.session_id
      LEFT JOIN session_lineage AS historical
        ON historical.session_id = execution.session_id
      LEFT JOIN derived_child_management_grants AS grants
        ON grants.child_session_id = execution.session_id
      LEFT JOIN session_client_profiles AS profiles
        ON execution.authority_origin_caller_id = ${'profile:'} || profiles.id
      WHERE execution.session_id = ${sessionId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row)
      return { authorizationCeiling: ASK, revoked: true } satisfies SessionAuthorizationBoundary
    const missingWorkerGrant = row.parent_session_id !== null && row.grant_ceiling === null
    const revoked =
      missingWorkerGrant || row.grant_revoked_at !== null || row.profile_revoked_at !== null
    const ceilings = [row.execution_ceiling, row.grant_ceiling, row.profile_ceiling].filter(
      (ceiling): ceiling is AgentAuthorizationMode => ceiling !== null,
    )
    return {
      authorizationCeiling: narrower(ceilings),
      revoked,
    } satisfies SessionAuthorizationBoundary
  })
}

function callerCeiling(
  sql: SqlClient.SqlClient,
  callerId: string,
  depth: number,
): Effect.Effect<AgentAuthorizationMode, unknown> {
  if (isLocalUserCallerId(callerId)) return Effect.succeed(YOLO)
  if (isProfileCallerId(callerId)) {
    return Effect.gen(function* () {
      const rows = yield* sql<{
        readonly authorization_ceiling: AgentAuthorizationMode
        readonly revoked_at: number | null
      }>`
        SELECT authorization_ceiling, revoked_at FROM session_client_profiles
        WHERE id = ${callerId.slice('profile:'.length)}
        LIMIT 1
      `
      const profile = rows[0]
      return profile && profile.revoked_at === null ? profile.authorization_ceiling : ASK
    })
  }
  const agent = parseSessionAgentCallerId(callerId)
  if (!agent) return Effect.succeed(ASK)
  return Effect.gen(function* () {
    const boundary = yield* sessionAgentAuthorizationBoundary(sql, agent.sessionId)
    if (boundary.revoked) return ASK
    return narrower([
      boundary.authorizationCeiling,
      yield* runInitiatorCeiling(sql, agent.sessionId, agent.runId, depth + 1),
    ])
  })
}

/**
 * The Run whose initiator bounds `runId`. Waggle Runs have no `session_runs` row: an
 * agent-requested Waggle runs inside the Session's active classic Run, whose initiator applies,
 * and an explicit Waggle is GUI-only, so with no active Run there is nothing narrower to apply.
 */
function initiatorRow(sql: SqlClient.SqlClient, sessionId: string, runId: string) {
  return Effect.gen(function* () {
    const exact = yield* sql<InitiatorRow>`
      SELECT json_extract(intent_json, '$.callerId') AS initiator_caller_id,
        json_extract(intent_json, '$.authorCallerId') AS author_caller_id
      FROM session_runs
      WHERE id = ${runId} AND session_id = ${sessionId}
      LIMIT 1
    `
    if (exact[0]) return exact[0]
    const active = yield* sql<InitiatorRow>`
      SELECT json_extract(intent_json, '$.callerId') AS initiator_caller_id,
        json_extract(intent_json, '$.authorCallerId') AS author_caller_id
      FROM session_runs
      WHERE session_id = ${sessionId}
        AND status IN (${'starting'}, ${'active'}, ${'stopping'})
      ORDER BY created_at DESC
      LIMIT 1
    `
    return active[0]
  })
}

/**
 * The narrowest Authorization ceiling of whoever started this Run and, for a re-authorized
 * Follow-up, whoever wrote it. A Session agent acts under this as well as its own Session's ceiling,
 * so an ask-for-approval caller that messages a yolo Session cannot have that Session start yolo
 * Runs on its behalf. An initiator the Host cannot identify counts as ask-for-approval.
 */
export function runInitiatorCeiling(
  sql: SqlClient.SqlClient,
  sessionId: string,
  runId: string,
  depth = 0,
): Effect.Effect<AgentAuthorizationMode, unknown> {
  if (depth > MAX_RUN_INITIATOR_CHAIN_DEPTH) return Effect.succeed(ASK)
  return Effect.gen(function* () {
    const row = yield* initiatorRow(sql, sessionId, runId)
    // Only an explicit Waggle Run, which the GUI starts, has neither; the Session's own ceiling
    // still applies to it.
    if (!row) return YOLO
    if (!row.initiator_caller_id) return ASK
    const callers = [row.initiator_caller_id, row.author_caller_id].filter(
      (caller): caller is string => caller !== null,
    )
    const ceilings: AgentAuthorizationMode[] = []
    for (const caller of callers) ceilings.push(yield* callerCeiling(sql, caller, depth))
    return narrower(ceilings)
  })
}

/** The ceiling of the Run a `session-agent:<session>:<run>` caller acts in, or yolo otherwise. */
export function sessionAgentCallerRunCeiling(sql: SqlClient.SqlClient, callerId: string) {
  const agent = parseSessionAgentCallerId(callerId)
  return agent ? runInitiatorCeiling(sql, agent.sessionId, agent.runId) : Effect.succeed(YOLO)
}
