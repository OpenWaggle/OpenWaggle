import type { InlineVisualizationContext } from '@shared/types/agent'
import type { FollowUpId, RunId } from '@shared/types/brand'
import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import type { WaggleInvocation } from '@shared/types/waggle'
import {
  type FollowUpEditReleaseOutcome,
  isFollowUpEditHeld,
  type QueueOutcomeBase,
  releasedOutcome,
} from './follow-up-edit-release'
import { MAX_FOLLOW_UP_QUEUE_BYTES } from './follow-up-queue'
import type {
  SessionControlFollowUp,
  SessionControlFollowUpEditHold,
  SessionControlIntentSnapshot,
  SessionControlSessionState,
} from './message-aggregate'

/**
 * Follow-up edit and Follow-up edit hold (ADR 0043).
 *
 * An edit replaces a pending Follow-up's intent snapshot in place: same Follow-up identity, same
 * position. Only the caller that queued the Follow-up may edit it, and its provenance (caller,
 * author, acceptance time, idempotency key) and its run settings (thinking level, authorization
 * override, interaction timeout) never change; only the message content does.
 *
 * Beginning an edit puts a hold on the item. Delivery stops at a held item: nothing from it onward
 * starts at Run settlement, on resumption, or by steering promotion, and a new message to an idle
 * Session with a held head queues behind it. Saving or cancelling releases the hold, and if the
 * Session is idle and its queue runnable the next Follow-up starts, as on resumption.
 */

const REVISION_INCREMENT = 1

export interface FollowUpEditContent {
  readonly text: string
  readonly attachmentIds: readonly string[]
  readonly waggle?: WaggleInvocation
  readonly visualizationContext?: InlineVisualizationContext
}

export type FollowUpEditRejectionCode =
  | 'follow_up_not_found'
  | 'follow_up_not_editable'
  | 'follow_up_edit_held'
  | 'follow_up_edit_not_held'
  | 'follow_up_edit_hold_mismatch'
  | 'queue_revision_changed'
  | 'queue_byte_capacity_reached'

interface FollowUpEditRejection {
  readonly accepted: false
  readonly code: FollowUpEditRejectionCode
  readonly currentRevision: number
  readonly state: SessionControlSessionState
}

export type BeginFollowUpEditResult =
  | {
      readonly accepted: true
      readonly state: SessionControlSessionState
      readonly outcome: QueueOutcomeBase & {
        readonly operation: 'queue-edit-begin'
        readonly effect: 'follow-up-edit-held'
        readonly followUpId: FollowUpId
        readonly holdId: string
        readonly leaseExpiresAt: number
      }
    }
  | FollowUpEditRejection

export type ReleaseFollowUpEditResult =
  | {
      readonly accepted: true
      readonly state: SessionControlSessionState
      readonly outcome: FollowUpEditReleaseOutcome
    }
  | FollowUpEditRejection

/** Who wrote the Follow-up: its author, or the caller that queued it when nobody re-authorized it. */
function followUpAuthor(intent: SessionControlIntentSnapshot) {
  return intent.authorCallerId ?? intent.callerId
}

/**
 * Only the caller that queued a Follow-up can edit it. Both the author and the delivery caller must
 * be that caller: attachments are owned by the delivery caller, so a Follow-up re-authorized by
 * someone else could not deliver attachments the author binds.
 */
export { type FollowUpEditReleaseOutcome, isFollowUpEditHeld } from './follow-up-edit-release'

export function canEditFollowUp(item: SessionControlFollowUp, callerId: string) {
  return item.intent.callerId === callerId && followUpAuthor(item.intent) === callerId
}

function rejection(
  state: SessionControlSessionState,
  code: FollowUpEditRejectionCode,
): FollowUpEditRejection {
  return { accepted: false, code, currentRevision: state.followUpQueue.revision, state }
}

function replaceItem(
  state: SessionControlSessionState,
  index: number,
  item: SessionControlFollowUp,
): SessionControlSessionState {
  const items = [...state.followUpQueue.items]
  items[index] = item
  return {
    ...state,
    revision: state.revision + REVISION_INCREMENT,
    followUpQueue: {
      ...state.followUpQueue,
      revision: state.followUpQueue.revision + REVISION_INCREMENT,
      items,
    },
  }
}

function withoutHold(item: SessionControlFollowUp): SessionControlFollowUp {
  const { editHold: _editHold, ...released } = item
  return released
}

function serializedBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function queueBytesWith(
  items: readonly SessionControlFollowUp[],
  index: number,
  intent: SessionControlIntentSnapshot,
) {
  return items.reduce(
    (bytes, item, itemIndex) => bytes + serializedBytes(itemIndex === index ? intent : item.intent),
    0,
  )
}

/** The edited intent: new content, everything else (provenance and run settings) unchanged. */
export function editedIntent(
  intent: SessionControlIntentSnapshot,
  content: FollowUpEditContent,
): SessionControlIntentSnapshot {
  const {
    text: _text,
    attachmentIds: _attachmentIds,
    waggle: _waggle,
    visualizationContext: _visualizationContext,
    ...retained
  } = intent
  return {
    ...retained,
    text: content.text,
    attachmentIds: content.attachmentIds,
    ...(content.waggle ? { waggle: content.waggle } : {}),
    ...(content.visualizationContext ? { visualizationContext: content.visualizationContext } : {}),
  }
}

export function beginFollowUpEdit(input: {
  readonly state: SessionControlSessionState
  readonly followUpId: FollowUpId
  readonly callerId: string
  readonly holdId: string
  readonly acquiredAt: number
  readonly leaseMs: number
}): BeginFollowUpEditResult {
  const { state } = input
  const index = state.followUpQueue.items.findIndex((item) => item.id === input.followUpId)
  const item = state.followUpQueue.items[index]
  if (!item) return rejection(state, 'follow_up_not_found')
  if (!canEditFollowUp(item, input.callerId)) return rejection(state, 'follow_up_not_editable')
  if (isFollowUpEditHeld(item)) return rejection(state, 'follow_up_edit_held')
  const editHold: SessionControlFollowUpEditHold = {
    holdId: input.holdId,
    holderCallerId: input.callerId,
    acquiredAt: input.acquiredAt,
    expiresAt: input.acquiredAt + input.leaseMs,
  }
  const next = replaceItem(state, index, { ...item, editHold })
  return {
    accepted: true,
    state: next,
    outcome: {
      operation: 'queue-edit-begin',
      effect: 'follow-up-edit-held',
      sessionId: state.sessionId,
      followUpId: item.id,
      holdId: input.holdId,
      leaseExpiresAt: editHold.expiresAt,
      queueRevision: next.followUpQueue.revision,
      stateRevision: next.revision,
    },
  }
}

export function saveFollowUpEdit(input: {
  readonly state: SessionControlSessionState
  readonly followUpId: FollowUpId
  readonly callerId: string
  readonly holdId: string
  readonly expectedQueueRevision: number
  readonly content: FollowUpEditContent
  readonly nextRunId: RunId
  /** The Host refused to admit the Run the release would start; pause with this reason. */
  readonly deferDelivery?: FollowUpQueuePauseReason
}): ReleaseFollowUpEditResult {
  const { state } = input
  if (state.followUpQueue.revision !== input.expectedQueueRevision) {
    return rejection(state, 'queue_revision_changed')
  }
  const index = state.followUpQueue.items.findIndex((item) => item.id === input.followUpId)
  const item = state.followUpQueue.items[index]
  if (!item) return rejection(state, 'follow_up_not_found')
  if (!item.editHold) return rejection(state, 'follow_up_edit_not_held')
  if (item.editHold.holdId !== input.holdId) return rejection(state, 'follow_up_edit_hold_mismatch')
  if (!canEditFollowUp(item, input.callerId)) return rejection(state, 'follow_up_not_editable')
  const intent = editedIntent(item.intent, input.content)
  if (queueBytesWith(state.followUpQueue.items, index, intent) > MAX_FOLLOW_UP_QUEUE_BYTES) {
    return rejection(state, 'queue_byte_capacity_reached')
  }
  const saved = replaceItem(state, index, { ...withoutHold(item), intent })
  return {
    accepted: true,
    ...releasedOutcome(saved, 'queue-edit-save', input.nextRunId, input.deferDelivery),
  }
}

/**
 * Releases a hold without changing the Follow-up. A hold that is already gone (saved, expired,
 * withdrawn, or delivered) releases successfully, so a window closing late or a lease expiring
 * converge on the same result; only another hold on the same item is refused.
 */
export function cancelFollowUpEdit(input: {
  readonly state: SessionControlSessionState
  readonly followUpId: FollowUpId
  readonly holdId: string
  readonly nextRunId: RunId
  readonly deferDelivery?: FollowUpQueuePauseReason
}): ReleaseFollowUpEditResult {
  const { state } = input
  const index = state.followUpQueue.items.findIndex((item) => item.id === input.followUpId)
  const item = state.followUpQueue.items[index]
  if (item?.editHold && item.editHold.holdId !== input.holdId) {
    return rejection(state, 'follow_up_edit_hold_mismatch')
  }
  const released = item?.editHold ? replaceItem(state, index, withoutHold(item)) : state
  return {
    accepted: true,
    ...releasedOutcome(released, 'queue-edit-cancel', input.nextRunId, input.deferDelivery),
  }
}
