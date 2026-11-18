import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'

/**
 * A `message` or `start` that set a thinking level makes it the Session's, as if chosen there. It is
 * written with the state that admits the starting Run, so the Run and every later one read it, and
 * no other change can land between the admission and the Session setting.
 */
export function persistRunStartThinkingLevel(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
  now: number,
) {
  if (state.run.state !== 'starting' || state.run.intent.thinkingLevel === undefined) {
    return Effect.void
  }
  return sql`
    UPDATE session_execution_profiles
    SET profile_json = json_set(profile_json, '$.thinkingLevel', ${state.run.intent.thinkingLevel}),
        updated_at = ${now}
    WHERE session_id = ${state.sessionId} AND json_valid(profile_json)
  `.pipe(Effect.asVoid)
}
