import type { FollowUpId, RunId } from '@shared/types/brand'
import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import type {
  SessionControlFollowUp,
  SessionControlIntentSnapshot,
  SessionControlSessionState,
} from './message-aggregate'
import { isPersonStartedRun } from './person-started-run'

/**
 * Queue delivery around Follow-up edit holds (ADR 0044).
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
 * The queue's next delivery waits on an edit, so it is delivered once the edit ends: the queue
 * runs and its head is a pending Follow-up out for editing, or the queue waits on agents' capacity
 * and an edit holds the person's first pending Follow-up, which then starts past it
 * (`deliverPersonFollowUpPastCapacity`). Any other paused queue, or a held item further back,
 * does not make the Session's work pending.
 */
export function waitsOnHeldNextFollowUp(state: SessionControlSessionState) {
  const queue = state.followUpQueue
  const head = queue.items[0]
  if (queue.state === 'running') {
    return head?.deliveryState === 'pending' && isFollowUpEditHeld(head)
  }
  if (queue.pauseReason !== 'parent-limit' || queue.deferredRetryAfter !== undefined) return false
  const index = queue.items.findIndex(
    (item) => item.deliveryState === 'pending' && isPersonStartedRun(item.intent),
  )
  return index >= 0 && queue.items.slice(0, index + 1).some(isFollowUpEditHeld)
}

function withoutDeferredRetry(state: SessionControlSessionState) {
  const { deferredRetryAfter: _deferredRetryAfter, ...queue } = state.followUpQueue
  return { ...state, followUpQueue: queue }
}

function startItem(state: SessionControlSessionState, index: number, nextRunId: RunId) {
  const item = state.followUpQueue.items[index]
  if (!item) {
    const delivery: IdleQueueDelivery = { state }
    return delivery
  }
  const queue = withoutDeferredRetry(state).followUpQueue
  const delivery: IdleQueueDelivery = {
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
  return delivery
}

/**
 * The explicit retry of a failed Run (see `planRunSettlement`) that waited behind a hold starts
 * once nothing up to it is held, ahead of the paused items accepted before the failure.
 */
function deliverDeferredRetry(
  state: SessionControlSessionState,
  acceptedAfter: number,
  nextRunId: RunId,
) {
  const items = state.followUpQueue.items
  const retryIndex = items.findIndex((item) => item.intent.acceptedAt > acceptedAfter)
  const retry = items[retryIndex]
  if (retry === undefined) {
    const delivery: IdleQueueDelivery = { state: withoutDeferredRetry(state) }
    return delivery
  }
  if (items.slice(0, retryIndex + 1).some(isFollowUpEditHeld)) {
    const delivery: IdleQueueDelivery = { state }
    return delivery
  }
  if (retry.deliveryState !== 'pending') {
    const delivery: IdleQueueDelivery = { state: withoutDeferredRetry(state) }
    return delivery
  }
  return startItem(state, retryIndex, nextRunId)
}

/**
 * Starts what an idle Session's queue would deliver now: the deferred retry of a failed Run, or the
 * head of a running queue when it is pending and not held (the resumption rule).
 */
export function deliverIdleQueueHead(state: SessionControlSessionState, nextRunId: RunId) {
  if (state.run.state !== 'idle') return { state } satisfies IdleQueueDelivery
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
    return { state } satisfies IdleQueueDelivery
  }
  return startItem(state, 0, nextRunId)
}

/**
 * Starts the person's first pending Follow-up in an idle Session whose queue waits on agents'
 * capacity (`parent-limit`), ahead of the agents' Follow-ups the limit holds back: the person's
 * work never waits on agents' work (ADR 0030, amended 2026-11-10). The queue stays paused for the
 * rest. A held item up to it, or a failed Run's deferred retry, still comes first. With
 * `retriesAfter` (a failed Run's agent retry was refused) the queue keeps its own pause, and only
 * the person's explicit retry, accepted after that time, starts.
 */
export function deliverPersonFollowUpPastCapacity(
  state: SessionControlSessionState,
  nextRunId: RunId,
  retriesAfter?: number,
) {
  const queue = state.followUpQueue
  const waitsOnCapacity =
    retriesAfter !== undefined ||
    (queue.pauseReason === 'parent-limit' && queue.deferredRetryAfter === undefined)
  if (state.run.state !== 'idle' || queue.state !== 'paused' || !waitsOnCapacity) {
    return { state }
  }
  const index = queue.items.findIndex(
    (item) =>
      item.deliveryState === 'pending' &&
      isPersonStartedRun(item.intent) &&
      (retriesAfter === undefined || item.intent.acceptedAt > retriesAfter),
  )
  if (index < 0 || queue.items.slice(0, index + 1).some(isFollowUpEditHeld)) return { state }
  return startItem(state, index, nextRunId)
}

/**
 * When the Host cannot admit the Run a delivery would start, the queue pauses instead, so it never
 * sits idle and runnable. Both Worker limits pause with `parent-limit`, a reason every binary
 * decodes. A queue paused already (a failed Run's deferred retry) keeps its own reason: what it
 * holds waits for the person's Resume, not for a slot.
 */
export function pauseUndeliveredQueue(
  state: SessionControlSessionState,
  reason: FollowUpQueuePauseReason,
) {
  const queue = withoutDeferredRetry(state).followUpQueue
  return {
    ...state,
    revision: state.revision + REVISION_INCREMENT,
    followUpQueue: {
      ...queue,
      state: 'paused',
      ...(queue.state === 'paused' ? {} : { pauseReason: reason }),
      revision: queue.revision + REVISION_INCREMENT,
    },
  } satisfies SessionControlSessionState
}

/** Marks `followUpId` as needing attention for `reason`; delivery passes over it. */
export function markFollowUpNeedsAttention(
  state: SessionControlSessionState,
  followUpId: FollowUpId,
  reason: NonNullable<SessionControlFollowUp['attentionReason']>,
) {
  const queue = state.followUpQueue
  return {
    ...state,
    revision: state.revision + REVISION_INCREMENT,
    followUpQueue: {
      ...queue,
      revision: queue.revision + REVISION_INCREMENT,
      items: queue.items.map((item) =>
        item.id === followUpId
          ? { ...item, deliveryState: 'needs_attention' as const, attentionReason: reason }
          : item,
      ),
    },
  }
}
