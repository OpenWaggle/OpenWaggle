import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'

/**
 * Whether Worker Run `runId` may replace its Delegation's unreviewed result: it is a Hive wake
 * (the Worker's own Workers reported) that started no earlier than that result, and no result
 * came from it yet. A nested Queen's first "still waiting" answer must not be the last its parent
 * hears. Identity, not only time, decides "from it": a wake may start in the millisecond the
 * previous Run's result was captured. `whileActive` requires the Run to be the Worker's current
 * one, for a submission made from inside it.
 */
export function wakeMayReplaceResult(
  sql: SqlClient.SqlClient,
  input: {
    readonly delegationId: string
    readonly workerSessionId: string
    readonly runId: string
    readonly whileActive: boolean
  },
) {
  const agentCallerId = `session-agent:${input.workerSessionId}:${input.runId}`
  return sql<{ readonly replaces: number }>`
    SELECT EXISTS (
      SELECT 1 FROM session_runs AS runs
      WHERE runs.id = ${input.runId}
        AND runs.session_id = ${input.workerSessionId}
        AND json_extract(runs.intent_json, '$.hiveWake') = 1
        AND (${input.whileActive ? 0 : 1} = 1 OR (
          runs.status IN (${'starting'}, ${'active'})
          AND runs.id = (
            SELECT latest.id FROM session_runs AS latest
            WHERE latest.session_id = ${input.workerSessionId}
            ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
          )
        ))
        AND runs.created_at >= COALESCE((
          SELECT MAX(submissions.created_at) FROM delegation_submissions AS submissions
          WHERE submissions.delegation_id = ${input.delegationId}
        ), 0)
        AND NOT EXISTS (
          SELECT 1 FROM delegation_submissions AS own
          WHERE own.delegation_id = ${input.delegationId}
            AND (own.source_run_id = ${input.runId} OR own.submitted_by = ${agentCallerId})
        )
    ) AS replaces
  `.pipe(Effect.map((rows) => rows[0]?.replaces === 1))
}
