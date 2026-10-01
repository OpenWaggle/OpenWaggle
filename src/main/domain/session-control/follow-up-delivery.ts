import type { FollowUpId, RunId } from '@shared/types/brand'
import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import type {
  SessionControlFollowUp,
  SessionControlIntentSnapshot,
  SessionControlSessionState,
} from './message-aggregate'

/**
 * Queue delivery around Follow-up edit holds (ADR 0043).
 *
 * An idle Session whose queue could deliver must not stay idle: nothing else would start it, and a
 * later message would queue behind it forever. Holds break that invariant whenever they go away
 * without a delivery decision (save, cancel, expiry, withdrawal or reordering of the held item), so
 * every accepted queue change and every Run settlement ends with `deliverIdleQueueHead`.
 */

const REVISION_INCREMENT = 1

export interface DeliveredFollowUp {
  readonly followUpId: FollowUpId
  readonly runId: RunId
  readonly intent: SessionControlIntentSnapshot
}

export interface IdleQueueDelivery {
  readonly state: SessionControlSessionState
  readonly delivered?: DeliveredFollowUp
}

/** A held item blocks delivery of itself and of every item behind it. */
export function isFollowUpEditHeld(item: SessionControlFollowUp | undefined) {
  return item?.editHold !== undefined
}

/**
 * The queue's next delivery waits on an edit: the queue runs and its head is a pending Follow-up
 * out for editing, so it is delivered once the edit ends. A paused queue, or a held item further
 * back, does not make the Session's work pending.
 */
export function waitsOnHeldNextFollowUp(state: SessionControlSessionState) {
  const head = state.followUpQueue.items[0]
  return (
    state.followUpQueue.state === 'running' &&
    head?.deliveryState === 'pending' &&
    isFollowUpEditHeld(head)
  )
}

function withoutDeferredRetry(state: SessionControlSessionState): SessionControlSessionState {
  const { deferredRetryAfter: _deferredRetryAfter, ...queue } = state.followUpQueue
  return { ...state, followUpQueue: queue }
}

function startItem(
  state: SessionControlSessionState,
  index: number,
  nextRunId: RunId,
): IdleQueueDelivery {
  const item = state.followUpQueue.items[index]
  if (!item) return { state }
  const queue = withoutDeferredRetry(state).followUpQueue
  return {
    state: {
      ...state,
      revision: state.revision + REVISION_INCREMENT,
      run: { state: 'starting', runId: nextRunId, intent: item.intent },
      followUpQueue: {
        ...queue,
        revision: queue.revision + REVISION_INCREMENT,
        items: queue.items.filter((_, itemIndex) => itemIndex !== index),
      },
    },
    delivered: { followUpId: item.id, runId: nextRunId, intent: item.intent },
  }
}

/**
 * The explicit retry of a failed Run (see `planRunSettlement`) that waited behind a hold starts
 * once nothing up to it is held, ahead of the paused items accepted before the failure.
 */
function deliverDeferredRetry(
  state: SessionControlSessionState,
  acceptedAfter: number,
  nextRunId: RunId,
): IdleQueueDelivery {
  const items = state.followUpQueue.items
  const retryIndex = items.findIndex((item) => item.intent.acceptedAt > acceptedAfter)
  const retry = items[retryIndex]
  if (retry === undefined) return { state: withoutDeferredRetry(state) }
  if (items.slice(0, retryIndex + 1).some(isFollowUpEditHeld)) return { state }
  if (retry.deliveryState !== 'pending') return { state: withoutDeferredRetry(state) }
  return startItem(state, retryIndex, nextRunId)
}

/**
 * Starts what an idle Session's queue would deliver now: the deferred retry of a failed Run, or the
 * head of a running queue when it is pending and not held (the resumption rule).
 */
export function deliverIdleQueueHead(
  state: SessionControlSessionState,
  nextRunId: RunId,
): IdleQueueDelivery {
  if (state.run.state !== 'idle') return { state }
  const { deferredRetryAfter } = state.followUpQueue
  if (deferredRetryAfter !== undefined) {
    return deliverDeferredRetry(state, deferredRetryAfter, nextRunId)
  }
  const head = state.followUpQueue.items[0]
  if (
    state.followUpQueue.state !== 'running' ||
    head?.deliveryState !== 'pending' ||
    isFollowUpEditHeld(head)
  ) {
    return { state }
  }
  return startItem(state, 0, nextRunId)
}

/**
 * When the Host cannot admit the Run a delivery would start, the queue pauses instead, so it never
 * sits idle and runnable. Without a reason the pause is stored without one, which every binary
 * decodes; the Host has no pause reason for its own Run ceiling.
 */
export function pauseUndeliveredQueue(
  state: SessionControlSessionState,
  reason?: FollowUpQueuePauseReason,
): SessionControlSessionState {
  const { pauseReason: _pauseReason, ...queue } = withoutDeferredRetry(state).followUpQueue
  return {
    ...state,
    revision: state.revision + REVISION_INCREMENT,
    followUpQueue: {
      ...queue,
      state: 'paused',
      ...(reason ? { pauseReason: reason } : {}),
      revision: queue.revision + REVISION_INCREMENT,
    },
  }
}
