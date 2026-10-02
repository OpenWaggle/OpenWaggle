/**
 * Follow-up edit and Follow-up edit hold (ADR 0043).
 *
 * An edit replaces a pending Follow-up's intent snapshot in place: same Follow-up identity, same
 * position. Only the caller that queued the Follow-up may edit it, and its provenance (caller,
 * author, acceptance time, idempotency key) and interaction timeout never change; only the message
 * content does. A Follow-up carries no thinking level or Run authorization override.
 *
 * Beginning an edit puts a hold on the item. Delivery stops at a held item: nothing from it onward
 * starts at Run settlement, on resumption, or by steering promotion, and a new message to an idle
 * Session with a held head of a running queue queues behind it. Saving or cancelling releases the
 * hold; what the queue then delivers is decided by `deliverIdleQueueHead`, which the repository
 * applies after every accepted queue change.
 *
 * Revision rule: a save names the queue revision its edit began at (`baseQueueRevision`), not the
 * queue's current revision. While held, a Follow-up's content can change only through this edit;
 * anything else that changes the item ends the hold (withdrawal, delivery, adoption by another
 * caller), and the save is then refused as not held. Reordering, and changes to other
 * items, do not affect a save.
 */
import type { InlineVisualizationContext } from '@shared/types/agent'
import type { FollowUpId } from '@shared/types/brand'
import type { WaggleInvocation } from '@shared/types/waggle'
import { isFollowUpEditHeld } from './follow-up-delivery'
import { MAX_FOLLOW_UP_QUEUE_BYTES, serializedBytes } from './follow-up-queue'
import type {
  SessionControlFollowUp,
  SessionControlFollowUpEditHold,
  SessionControlIntentSnapshot,
  SessionControlSessionState,
} from './message-aggregate'

export { isFollowUpEditHeld } from './follow-up-delivery'

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

interface QueueOutcomeBase {
  readonly sessionId: SessionControlSessionState['sessionId']
  readonly queueRevision: number
  readonly stateRevision: number
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
      readonly outcome: QueueOutcomeBase & {
        readonly operation: 'queue-edit-save' | 'queue-edit-cancel'
        readonly effect: 'queue-updated'
        readonly queueState: 'running' | 'paused'
        readonly followUpIds: readonly string[]
      }
    }
  | FollowUpEditRejection

/** The provenance that decides who may edit a Follow-up. */
export interface FollowUpEditProvenance {
  readonly callerId: string
  readonly authorCallerId?: string
}

/**
 * Only the caller that queued a Follow-up can edit it: attachments are owned by that caller. An
 * adopted Follow-up (`queue-adopt`) is not editable: its content and attachments stay its
 * author's, so the adopter can send or dismiss it but not rewrite it.
 */
export function canEditFollowUp(intent: FollowUpEditProvenance, callerId: string) {
  return intent.callerId === callerId && intent.authorCallerId === undefined
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

/**
 * Whether an edit grows the queue past its byte cap. A queue already past the cap (returned steers
 * ignore it) still accepts an edit that does not grow it, so an edit can always shrink an item.
 */
function exceedsQueueBytes(
  items: readonly SessionControlFollowUp[],
  index: number,
  intent: SessionControlIntentSnapshot,
) {
  const current = items.reduce((bytes, item) => bytes + serializedBytes(item.intent), 0)
  const edited = current - serializedBytes(items[index]?.intent ?? intent) + serializedBytes(intent)
  return edited > MAX_FOLLOW_UP_QUEUE_BYTES && edited > current
}

function released(
  state: SessionControlSessionState,
  operation: 'queue-edit-save' | 'queue-edit-cancel',
): ReleaseFollowUpEditResult {
  return {
    accepted: true,
    state,
    outcome: {
      operation,
      effect: 'queue-updated',
      sessionId: state.sessionId,
      queueState: state.followUpQueue.state,
      queueRevision: state.followUpQueue.revision,
      followUpIds: state.followUpQueue.items.map((item) => item.id),
      stateRevision: state.revision,
    },
  }
}

/** The edited intent: new content, everything else (provenance) unchanged. */
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
  /** Wall clock, shown to the user. */
  readonly acquiredAt: number
  /** The lease length a client can expect, for the outcome's wall-clock estimate. */
  readonly leaseMs: number
}): BeginFollowUpEditResult {
  const { state } = input
  const index = state.followUpQueue.items.findIndex((item) => item.id === input.followUpId)
  const item = state.followUpQueue.items[index]
  if (!item) return rejection(state, 'follow_up_not_found')
  if (!canEditFollowUp(item.intent, input.callerId)) {
    return rejection(state, 'follow_up_not_editable')
  }
  if (isFollowUpEditHeld(item)) return rejection(state, 'follow_up_edit_held')
  const baseQueueRevision = state.followUpQueue.revision + REVISION_INCREMENT
  const editHold: SessionControlFollowUpEditHold = {
    holdId: input.holdId,
    holderCallerId: input.callerId,
    acquiredAt: input.acquiredAt,
    missedSweeps: 0,
    baseQueueRevision,
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
      leaseExpiresAt: input.acquiredAt + input.leaseMs,
      queueRevision: baseQueueRevision,
      stateRevision: next.revision,
    },
  }
}

export function saveFollowUpEdit(input: {
  readonly state: SessionControlSessionState
  readonly followUpId: FollowUpId
  readonly callerId: string
  readonly holdId: string
  /** The `queueRevision` the edit began at (see the revision rule above). */
  readonly expectedQueueRevision: number
  readonly content: FollowUpEditContent
}): ReleaseFollowUpEditResult {
  const { state } = input
  const index = state.followUpQueue.items.findIndex((item) => item.id === input.followUpId)
  const item = state.followUpQueue.items[index]
  if (!item) return rejection(state, 'follow_up_not_found')
  if (!item.editHold) return rejection(state, 'follow_up_edit_not_held')
  if (item.editHold.holdId !== input.holdId) return rejection(state, 'follow_up_edit_hold_mismatch')
  if (item.editHold.baseQueueRevision !== input.expectedQueueRevision) {
    return rejection(state, 'queue_revision_changed')
  }
  if (!canEditFollowUp(item.intent, input.callerId)) {
    return rejection(state, 'follow_up_not_editable')
  }
  const intent = editedIntent(item.intent, input.content)
  if (exceedsQueueBytes(state.followUpQueue.items, index, intent)) {
    return rejection(state, 'queue_byte_capacity_reached')
  }
  return released(replaceItem(state, index, { ...withoutHold(item), intent }), 'queue-edit-save')
}

/**
 * Releases a hold without changing the Follow-up. Releasing a hold that is already gone (saved,
 * expired, withdrawn, or delivered) is an accepted no-op, so a window closing late and a lease
 * expiring converge on the same result; the repository then lets the queue deliver if it can,
 * which is how the expiry sweep resumes a queue. Only another hold on the same item is refused.
 */
export function cancelFollowUpEdit(input: {
  readonly state: SessionControlSessionState
  readonly followUpId: FollowUpId
  readonly holdId: string
}): ReleaseFollowUpEditResult {
  const { state } = input
  const index = state.followUpQueue.items.findIndex((item) => item.id === input.followUpId)
  const item = state.followUpQueue.items[index]
  if (item?.editHold && item.editHold.holdId !== input.holdId) {
    return rejection(state, 'follow_up_edit_hold_mismatch')
  }
  return released(
    item?.editHold ? replaceItem(state, index, withoutHold(item)) : state,
    'queue-edit-cancel',
  )
}
