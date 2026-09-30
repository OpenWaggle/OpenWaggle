import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'

/** `[runId, sessionId, callerId]`: who started each Run, as `session_runs.intent_json` records it. */
export type RunInitiator = readonly [runId: string, sessionId: string, callerId: string]

/** Creates a minimal `session_runs` table and records who started each Run. */
export function insertRunInitiators(sql: SqlClient.SqlClient, runs: readonly RunInitiator[]) {
  return Effect.gen(function* () {
    yield* sql.unsafe(
      'CREATE TABLE session_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_json TEXT)',
    )
    for (const [runId, sessionId, callerId] of runs) {
      yield* sql`INSERT INTO session_runs (id, session_id, intent_json)
        VALUES (${runId}, ${sessionId}, ${JSON.stringify({ callerId })})`
    }
  })
}
