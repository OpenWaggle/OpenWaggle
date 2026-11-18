import * as Effect from 'effect/Effect'
import type { SessionControlFollowUp } from '../domain/session-control/message-aggregate'
import { createLogger } from '../logger'

const logger = createLogger('session-control-returned-steers')

/**
 * Reports direct steers a settlement could not return to the queue because it already lists
 * `MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS` (only reachable when several displaced Runs return their
 * steers together). Their callers hold a steered-Run receipt, so the drop is logged with what
 * identifies each one to its caller (idempotency key and caller), never its text. Called after
 * the settlement committed, so a rolled-back settlement reports nothing.
 */
export function reportDroppedReturnedSteers(
  input: { readonly sessionId: string; readonly runId: string },
  dropped: readonly SessionControlFollowUp[],
) {
  if (dropped.length === 0) return Effect.void
  return Effect.sync(() => {
    logger.warn('Undelivered steering messages were dropped: the Follow-up queue is full', {
      sessionId: input.sessionId,
      runId: input.runId,
      droppedCount: dropped.length,
      dropped: dropped.map((item) => ({
        followUpId: item.id,
        callerId: item.intent.callerId,
        idempotencyKey: item.intent.idempotencyKey,
      })),
    })
  })
}
