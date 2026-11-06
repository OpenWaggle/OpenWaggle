import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'

/** The longest Worker text an orchestration update carries; the full result stays in the Worker. */
export const ORCHESTRATION_UPDATE_SUMMARY_LIMIT = 100_000

export interface OrchestrationUpdateInsert {
  readonly updateId: string
  readonly parentSessionId: string
  readonly workerSessionId: string
  readonly delegationId: string
  readonly sourceRunId: string
  readonly state: 'ready_for_review' | 'needs_attention'
  readonly summary: string
  readonly now: number
  /**
   * Who caused the update (`hive-wake-trigger-authority.ts`): the caller of a Worker's own
   * Delegation change, or the agent of the Worker Run whose end recorded it.
   */
  readonly triggerCallerId: string
}

/**
 * Records a pending orchestration update for a Worker's parent. One Worker Run can reach the same
 * state twice (it submits, the parent asks for a revision while the Run still works, and the Run
 * then ends with a reply), so a second update for that Run and state replaces the first under
 * its own id and is pending again: the parent hears about the latest result, not an old one.
 */
export function insertOrchestrationUpdate(
  sql: SqlClient.SqlClient,
  input: OrchestrationUpdateInsert,
) {
  return sql`
    INSERT INTO session_orchestration_updates (
      id, parent_session_id, worker_session_id, delegation_id, source_run_id,
      state, summary, status, created_at, trigger_caller_id
    ) VALUES (
      ${input.updateId}, ${input.parentSessionId}, ${input.workerSessionId},
      ${input.delegationId}, ${input.sourceRunId}, ${input.state},
      ${input.summary.slice(0, ORCHESTRATION_UPDATE_SUMMARY_LIMIT)}, ${'pending'}, ${input.now},
      ${input.triggerCallerId}
    )
    ON CONFLICT (delegation_id, source_run_id, state) DO UPDATE SET
      id = excluded.id,
      summary = excluded.summary,
      trigger_caller_id = excluded.trigger_caller_id,
      status = ${'pending'},
      delivered_run_id = NULL,
      delivered_item_id = NULL,
      delivered_at = NULL,
      created_at = excluded.created_at
  `
}

/**
 * Tells a Worker's parent about a Delegation change the Worker made itself through the Hive tool:
 * a submitted result, or its own request for help (`needs_attention`). Before this, only a Run's
 * end told the parent, so a Worker that submitted explicitly was never reported. The update
 * names the Worker's latest Run; a Worker that never ran has none, and nothing is recorded.
 */
export function recordWorkerOrchestrationUpdate(
  sql: SqlClient.SqlClient,
  input: {
    readonly delegationId: string
    readonly parentSessionId: string
    readonly workerSessionId: string
    readonly state: 'ready_for_review' | 'needs_attention'
    /** Distinguishes this update from the Run-end update the same Run might also record. */
    readonly cause: string
    readonly summary: string
    readonly now: number
    /** The caller that made the change. */
    readonly triggerCallerId: string
  },
) {
  return Effect.gen(function* () {
    const runs = yield* sql<{ readonly id: string }>`
      SELECT id FROM session_runs WHERE session_id = ${input.workerSessionId}
      ORDER BY created_at DESC, id DESC LIMIT 1
    `
    const sourceRunId = runs[0]?.id
    if (!sourceRunId) return undefined
    const updateId = `orchestration:${input.delegationId}:${sourceRunId}:${input.cause}`
    yield* insertOrchestrationUpdate(sql, {
      updateId,
      parentSessionId: input.parentSessionId,
      workerSessionId: input.workerSessionId,
      delegationId: input.delegationId,
      sourceRunId,
      state: input.state,
      summary: input.summary,
      now: input.now,
      triggerCallerId: input.triggerCallerId,
    })
    return updateId
  })
}
