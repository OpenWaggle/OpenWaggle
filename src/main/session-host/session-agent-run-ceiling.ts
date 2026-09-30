import type * as SqlClient from '@effect/sql/SqlClient'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import * as Effect from 'effect/Effect'
import {
  durableSessionRunId,
  followRunInitiatorChain,
  isLocalUserCallerId,
  isProfileCallerId,
  parseSessionAgentCallerId,
  RUN_INITIATOR_CHAIN_START,
  type RunInitiatorChain,
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
  chain: RunInitiatorChain,
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
      yield* runInitiatorCeiling(sql, agent.sessionId, agent.runId, chain),
    ])
  })
}

/**
 * The Run whose initiator bounds `runId`: that Run, or for an agent-requested Waggle, which has no
 * row of its own, the classic Run that requested it.
 */
function initiatorRow(sql: SqlClient.SqlClient, sessionId: string, runId: string) {
  return sql<InitiatorRow>`
    SELECT json_extract(intent_json, '$.callerId') AS initiator_caller_id,
      json_extract(intent_json, '$.authorCallerId') AS author_caller_id
    FROM session_runs
    WHERE id = ${durableSessionRunId(runId)} AND session_id = ${sessionId}
    LIMIT 1
  `.pipe(Effect.map((rows) => rows[0]))
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
  chain: RunInitiatorChain = RUN_INITIATOR_CHAIN_START,
): Effect.Effect<AgentAuthorizationMode, unknown> {
  const next = followRunInitiatorChain(chain, sessionId)
  if (!next) return Effect.succeed(ASK)
  return Effect.gen(function* () {
    const row = yield* initiatorRow(sql, sessionId, runId)
    if (!row?.initiator_caller_id) return ASK
    const callers = [row.initiator_caller_id, row.author_caller_id].filter(
      (caller): caller is string => caller !== null,
    )
    const ceilings: AgentAuthorizationMode[] = []
    for (const caller of callers) ceilings.push(yield* callerCeiling(sql, caller, next))
    return narrower(ceilings)
  })
}

/**
 * The Authorization boundary of a `session-agent:<session>:<run>` caller: its Session's boundary,
 * narrowed by whoever started the Run it acts in. The Run mode of anything that caller starts is
 * resolved through this, so it cannot exceed the ceiling of the caller it acts for.
 */
export function sessionAgentCallerBoundary(sql: SqlClient.SqlClient, callerId: string) {
  const agent = parseSessionAgentCallerId(callerId)
  if (!agent) return Effect.succeed(undefined)
  return Effect.gen(function* () {
    const boundary = yield* sessionAgentAuthorizationBoundary(sql, agent.sessionId)
    const runCeiling = yield* runInitiatorCeiling(sql, agent.sessionId, agent.runId).pipe(
      Effect.orElseSucceed(() => ASK),
    )
    return {
      authorizationCeiling: narrower([boundary.authorizationCeiling, runCeiling]),
      revoked: boundary.revoked,
    } satisfies SessionAuthorizationBoundary
  })
}
