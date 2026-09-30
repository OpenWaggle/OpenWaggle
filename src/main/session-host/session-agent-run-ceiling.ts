import type * as SqlClient from '@effect/sql/SqlClient'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import * as Effect from 'effect/Effect'
import {
  isLocalUserCallerId,
  isProfileCallerId,
} from '../domain/session-control/root-session-project-reach'

/** Hops through agents starting each other's Runs; a longer chain is treated as ask-for-approval. */
const MAX_INITIATOR_CHAIN_DEPTH = 8
const SESSION_AGENT_CALLER_PREFIX = 'session-agent:'
const ASK: AgentAuthorizationMode = 'ask-for-approval'
const YOLO: AgentAuthorizationMode = 'yolo'

function sessionAgentCaller(callerId: string) {
  if (!callerId.startsWith(SESSION_AGENT_CALLER_PREFIX)) return undefined
  const separator = callerId.lastIndexOf(':')
  if (separator <= SESSION_AGENT_CALLER_PREFIX.length) return undefined
  return {
    sessionId: callerId.slice(SESSION_AGENT_CALLER_PREFIX.length, separator),
    runId: callerId.slice(separator + 1),
  }
}

function narrower(modes: readonly AgentAuthorizationMode[]) {
  return modes.includes(ASK) ? ASK : YOLO
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
  const agent = sessionAgentCaller(callerId)
  if (!agent) return Effect.succeed(ASK)
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly authorization_ceiling: AgentAuthorizationMode }>`
      SELECT authorization_ceiling FROM session_execution_profiles
      WHERE session_id = ${agent.sessionId}
      LIMIT 1
    `
    const own = rows[0]?.authorization_ceiling ?? ASK
    return narrower([own, yield* runInitiatorCeiling(sql, agent.sessionId, agent.runId, depth + 1)])
  })
}

/**
 * The narrowest Authorization ceiling of whoever started this Run and, for a re-authorized
 * Follow-up, whoever wrote it. A Session agent acts under this as well as its own Session's ceiling,
 * so an ask-for-approval caller that messages a yolo Session cannot have that Session start yolo
 * Runs on its behalf. Unknown or unreadable data counts as ask-for-approval.
 */
export function runInitiatorCeiling(
  sql: SqlClient.SqlClient,
  sessionId: string,
  runId: string,
  depth = 0,
): Effect.Effect<AgentAuthorizationMode, unknown> {
  if (depth > MAX_INITIATOR_CHAIN_DEPTH) return Effect.succeed(ASK)
  return Effect.gen(function* () {
    const rows = yield* sql<{
      readonly initiator_caller_id: string | null
      readonly author_caller_id: string | null
    }>`
      SELECT json_extract(intent_json, '$.callerId') AS initiator_caller_id,
        json_extract(intent_json, '$.authorCallerId') AS author_caller_id
      FROM session_runs
      WHERE id = ${runId} AND session_id = ${sessionId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row?.initiator_caller_id) return ASK
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
  const agent = sessionAgentCaller(callerId)
  return agent ? runInitiatorCeiling(sql, agent.sessionId, agent.runId) : Effect.succeed(YOLO)
}
