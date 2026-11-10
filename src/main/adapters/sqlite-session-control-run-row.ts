import { matchBy } from '@diegogbrisa/ts-match'
import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'
import { isAgentWorkRun } from '../domain/session-control/person-started-run'

/**
 * Writes the Session's Run row: a starting Run is inserted with its intent and whether it is an
 * agent's work (`work_by_agent`, which Active Workers counts wherever it runs), and a later state
 * updates its status. Returns the active Run id for `session_control_states`.
 */
export function persistRun(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
  now: number,
) {
  return matchBy(state.run, 'state')
    .with('idle', () => Effect.succeed<string | null>(null))
    .with('starting', (run) =>
      sql`
        INSERT INTO session_runs (
          id, session_id, status, intent_json, created_at, updated_at, work_by_agent
        )
        VALUES (
          ${run.runId},
          ${state.sessionId},
          ${run.state},
          ${JSON.stringify(run.intent)},
          ${now},
          ${now},
          ${isAgentWorkRun(run.intent) ? 1 : 0}
        )
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          intent_json = excluded.intent_json,
          updated_at = excluded.updated_at,
          work_by_agent = excluded.work_by_agent
      `.pipe(Effect.as(String(run.runId))),
    )
    .with('active', (run) =>
      sql`
        UPDATE session_runs
        SET status = ${run.state}, updated_at = ${now}
        WHERE id = ${run.runId} AND session_id = ${state.sessionId}
      `.pipe(Effect.as(String(run.runId))),
    )
    .with('stopping', (run) =>
      sql`
        UPDATE session_runs
        SET status = ${run.state}, updated_at = ${now}
        WHERE id = ${run.runId} AND session_id = ${state.sessionId}
      `.pipe(Effect.as(String(run.runId))),
    )
    .exhaustive()
}
