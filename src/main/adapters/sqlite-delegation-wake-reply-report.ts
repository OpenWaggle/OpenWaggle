import type * as SqlClient from '@effect/sql/SqlClient'
import { type RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { SessionControlWorkerSettlementUpdate } from '../ports/session-control-run-lifecycle-repository'

interface WakeReplyContract {
  readonly id: string
  readonly parent_session_id: string
}

interface WakeReplySettlement {
  readonly sessionId: SessionId
  readonly runId: RunId
}

/** Records the update; the settlement module supplies it, so the cause is chosen in one place. */
type InsertSettlementUpdate<C, S> = (
  sql: SqlClient.SqlClient,
  input: {
    readonly updateId: string
    readonly contract: C
    readonly settlement: S
    readonly state: 'ready_for_review'
    readonly summary: string
    readonly now: number
  },
) => Effect.Effect<unknown, unknown>

const UNSUBMITTED_NOTE =
  'This Worker answered again in a Run it did for a client that is not behind its result waiting ' +
  'for review, so the answer below did not replace that result. Request a revision to get it as ' +
  'a result.'

/**
 * A nested Queen's wake that acted for a client not behind its unreviewed result answered again.
 * The answer may not replace that result (`wakeResultReplacement`), but the parent must still
 * hear that a newer one exists: it reaches the parent as an update, and the parent can ask for a
 * revision to get it as a result. The Delegation's state and result stay as they were.
 */
export function reportUnsubmittedWakeReply<
  C extends WakeReplyContract,
  S extends WakeReplySettlement,
>(
  sql: SqlClient.SqlClient,
  input: {
    readonly contract: C
    readonly settlement: S
    readonly summary: string
    readonly now: number
    readonly insertSettlementUpdate: InsertSettlementUpdate<C, S>
  },
) {
  const updateId = `orchestration:${input.contract.id}:${input.settlement.runId}:wake-reply`
  const update: SessionControlWorkerSettlementUpdate = {
    orchestrationUpdate: {
      updateId,
      parentSessionId: SessionId(input.contract.parent_session_id),
      workerSessionId: input.settlement.sessionId,
      delegationId: input.contract.id,
      sourceRunId: input.settlement.runId,
      state: 'ready_for_review',
    },
  }
  return input
    .insertSettlementUpdate(sql, {
      updateId,
      contract: input.contract,
      settlement: input.settlement,
      state: 'ready_for_review',
      summary: `${UNSUBMITTED_NOTE}\n\n${input.summary}`,
      now: input.now,
    })
    .pipe(Effect.as(update))
}
