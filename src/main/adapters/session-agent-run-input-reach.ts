import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  callerReachesEveryProject,
  sessionAgentRunReachesEveryProject,
} from './session-agent-run-project-reach'

/**
 * Whether input from `callerId` into a Run (a steer, a promoted Follow-up, or an answer to a
 * pending request) would come from a caller that lacks the Run's reach. Only a Run that reaches
 * every project needs the check. A promoted Follow-up is also judged by who wrote it, so a
 * catalog-wide caller cannot promote a narrower caller's text into such a Run.
 */
export function runInputWidensReach(
  sql: SqlClient.SqlClient,
  input: {
    readonly callerId: string
    readonly sessionId: string
    readonly runId: string
    readonly followUpId?: string
  },
) {
  return Effect.gen(function* () {
    if (!(yield* sessionAgentRunReachesEveryProject(sql, input.sessionId, input.runId))) {
      return false
    }
    if (!(yield* callerReachesEveryProject(sql, input.callerId))) return true
    if (input.followUpId === undefined) return false
    const rows = yield* sql<{ readonly caller_id: string | null }>`
      SELECT json_extract(intent_json, '$.callerId') AS caller_id
      FROM session_follow_ups
      WHERE id = ${input.followUpId} AND session_id = ${input.sessionId}
      LIMIT 1
    `
    const author = rows[0]?.caller_id
    if (author === undefined) return false
    if (author !== null && !(yield* callerReachesEveryProject(sql, author))) return true
    return false
  })
}
