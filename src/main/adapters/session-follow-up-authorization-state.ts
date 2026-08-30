import type {
  SessionControlFollowUp,
  SessionControlSessionState,
} from '../domain/session-control/message-aggregate'

type AttentionReason = NonNullable<SessionControlFollowUp['attentionReason']>
const REVISION_INCREMENT = 1

export function applyFollowUpAuthorizationState(
  state: SessionControlSessionState,
  reason: AttentionReason | undefined,
) {
  const followUp = state.followUpQueue.items[0]
  if (!followUp) return state
  if (!reason) {
    if (followUp.deliveryState === 'pending') return state
    const { attentionReason: _attentionReason, ...restored } = followUp
    return {
      ...state,
      revision: state.revision + REVISION_INCREMENT,
      followUpQueue: {
        ...state.followUpQueue,
        revision: state.followUpQueue.revision + REVISION_INCREMENT,
        items: [
          { ...restored, deliveryState: 'pending' as const },
          ...state.followUpQueue.items.slice(1),
        ],
      },
    }
  }
  const alreadyBlocked =
    followUp.deliveryState === 'needs_attention' && followUp.attentionReason === reason
  if (alreadyBlocked && state.followUpQueue.state === 'paused') return state
  return {
    ...state,
    revision: state.revision + REVISION_INCREMENT,
    followUpQueue: {
      ...state.followUpQueue,
      state: 'paused' as const,
      revision: state.followUpQueue.revision + REVISION_INCREMENT,
      items: [
        alreadyBlocked
          ? followUp
          : { ...followUp, deliveryState: 'needs_attention' as const, attentionReason: reason },
        ...state.followUpQueue.items.slice(1),
      ],
    },
  }
}
