/**
 * Follow-up adoption: the desktop user's way to resume a Follow-up that needs attention because
 * the authority it was queued under is gone (`profile_revoked`, `authority_changed`).
 *
 * Adopting re-authors the Follow-up as the adopting caller. It keeps its identity, position, and
 * content; `callerId` becomes the adopter, and whoever queued it stays as `authorCallerId` for
 * provenance and as the owner of its attachments. The Run it starts acts under the adopter's
 * authority: reach and ceiling checks read `callerId`. It carries no Run authorization override,
 * like every Follow-up. Revision-guarded like other queue changes.
 */
import type { FollowUpId } from '@shared/types/brand'
import type { SessionControlFollowUp, SessionControlSessionState } from './message-aggregate'

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
  const author = item.intent.authorCallerId ?? item.intent.callerId
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
    followUpQueue: { ...state.followUpQueue, revision: queueRevision, items },
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
