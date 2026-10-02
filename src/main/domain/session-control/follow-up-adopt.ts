/**
 * Follow-up adoption: the desktop user's way to resume a Follow-up that needs attention because
 * the authority it was queued under is gone (`profile_revoked`, `authority_changed`).
 *
 * Adopting re-authors the Follow-up as the adopting caller. It keeps its identity, position, and
 * content; `callerId` becomes the adopter, and whoever queued it stays as `authorCallerId` for
 * provenance and as the owner of its attachments. The Run it starts acts under the adopter's
 * authority: reach and ceiling checks read `callerId`. It carries no Run authorization override,
 * like every Follow-up. Revision-guarded like other queue changes.
 *
 * Every path that marks a Follow-up as needing attention also pauses its queue, so adopting the
 * last one also resumes the queue when that attention is what paused it (see
 * `resumesAttentionPause`). A queue the user paused, or one a failed Run or Host loss paused, stays
 * paused. The resumed queue then delivers like any accepted queue change: when the Session is idle
 * the Host starts its head with the same admission checks as resumption.
 */
import type { FollowUpId } from '@shared/types/brand'
import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import {
  followUpAttachmentOwner,
  type SessionControlFollowUp,
  type SessionControlSessionState,
} from './message-aggregate'

const REVISION_INCREMENT = 1

export type AdoptFollowUpRejectionCode =
  | 'follow_up_not_found'
  | 'follow_up_not_adoptable'
  | 'queue_revision_changed'

export type AdoptFollowUpResult =
  | {
      readonly accepted: true
      readonly state: SessionControlSessionState
      readonly outcome: {
        readonly operation: 'queue-adopt'
        readonly effect: 'queue-updated'
        readonly sessionId: SessionControlSessionState['sessionId']
        readonly queueState: 'running' | 'paused'
        readonly queueRevision: number
        readonly followUpIds: readonly string[]
        readonly stateRevision: number
      }
    }
  | {
      readonly accepted: false
      readonly code: AdoptFollowUpRejectionCode
      readonly currentRevision: number
      readonly state: SessionControlSessionState
    }

function adopted(item: SessionControlFollowUp, callerId: string): SessionControlFollowUp {
  const { attentionReason: _reason, editHold, ...rest } = item
  const author = followUpAttachmentOwner(item.intent)
  const { authorCallerId: _previousAuthor, ...intent } = item.intent
  return {
    ...rest,
    // Another caller's open edit of it ends: the Follow-up is now the adopter's.
    ...(editHold && editHold.holderCallerId === callerId ? { editHold } : {}),
    deliveryState: 'pending',
    intent: {
      ...intent,
      callerId,
      ...(author !== callerId ? { authorCallerId: author } : {}),
    },
  }
}

/**
 * The pause reasons the needs-attention paths leave: a revoked profile pausing a running queue
 * records `profile-revoked`, and a head whose authority changed pauses it with no reason. Any
 * other reason, including `requested`, came from somewhere else and outlives the adoption.
 */
const ATTENTION_PAUSE_REASONS: readonly (FollowUpQueuePauseReason | undefined)[] = [
  undefined,
  'profile-revoked',
]

function resumesAttentionPause(queue: SessionControlSessionState['followUpQueue']) {
  return (
    queue.state === 'paused' &&
    ATTENTION_PAUSE_REASONS.includes(queue.pauseReason) &&
    queue.items.every((item) => item.deliveryState === 'pending')
  )
}

function withQueue(
  queue: SessionControlSessionState['followUpQueue'],
  items: readonly SessionControlFollowUp[],
  revision: number,
): SessionControlSessionState['followUpQueue'] {
  const next = { ...queue, revision, items }
  if (!resumesAttentionPause(next)) return next
  const { pauseReason: _pauseReason, ...running } = next
  return { ...running, state: 'running' }
}

export function adoptFollowUp(input: {
  readonly state: SessionControlSessionState
  readonly followUpId: FollowUpId
  readonly callerId: string
  readonly expectedQueueRevision: number
}): AdoptFollowUpResult {
  const { state } = input
  const reject = (code: AdoptFollowUpRejectionCode): AdoptFollowUpResult => ({
    accepted: false,
    code,
    currentRevision: state.followUpQueue.revision,
    state,
  })
  if (state.followUpQueue.revision !== input.expectedQueueRevision) {
    return reject('queue_revision_changed')
  }
  const index = state.followUpQueue.items.findIndex((item) => item.id === input.followUpId)
  const item = state.followUpQueue.items[index]
  if (!item) return reject('follow_up_not_found')
  if (item.deliveryState !== 'needs_attention') return reject('follow_up_not_adoptable')

  const items = [...state.followUpQueue.items]
  items[index] = adopted(item, input.callerId)
  const queueRevision = state.followUpQueue.revision + REVISION_INCREMENT
  const stateRevision = state.revision + REVISION_INCREMENT
  const next: SessionControlSessionState = {
    ...state,
    revision: stateRevision,
    followUpQueue: withQueue(state.followUpQueue, items, queueRevision),
  }
  return {
    accepted: true,
    state: next,
    outcome: {
      operation: 'queue-adopt',
      effect: 'queue-updated',
      sessionId: next.sessionId,
      queueState: next.followUpQueue.state,
      queueRevision,
      followUpIds: items.map((candidate) => candidate.id),
      stateRevision,
    },
  }
}
