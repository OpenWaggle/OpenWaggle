import type { FollowUpId } from '@shared/types/brand'
import { mutateFollowUpQueue, queuedFollowUpQueueState } from './follow-up-queue'
import type {
  SessionControlFollowUp,
  SessionControlIntentSnapshot,
  SessionControlSessionState,
} from './message-aggregate'

const STATE_REVISION_INCREMENT = 1

/**
 * Appends a pending Follow-up to the Session's queue and advances the state revision. On
 * acceptance, `queued` holds the outcome fields a queued Follow-up reports.
 */
export function appendPendingFollowUp(input: {
  readonly state: SessionControlSessionState
  readonly followUpId: FollowUpId
  readonly intent: SessionControlIntentSnapshot
}) {
  const followUp: SessionControlFollowUp = {
    id: input.followUpId,
    intent: input.intent,
    deliveryState: 'pending',
  }
  const queueResult = mutateFollowUpQueue(input.state.followUpQueue, {
    type: 'append',
    item: followUp,
  })
  if (!queueResult.accepted) {
    if (
      queueResult.code !== 'follow_up_already_exists' &&
      queueResult.code !== 'queue_capacity_reached' &&
      queueResult.code !== 'queue_byte_capacity_reached'
    ) {
      throw new Error(`Unexpected Follow-up append rejection: ${queueResult.code}`)
    }
    return { accepted: false, code: queueResult.code } as const
  }

  const nextRevision = input.state.revision + STATE_REVISION_INCREMENT
  return {
    accepted: true,
    state: { ...input.state, revision: nextRevision, followUpQueue: queueResult.queue },
    queued: {
      followUpId: input.followUpId,
      ...queuedFollowUpQueueState(queueResult.queue),
      queueRevision: queueResult.queue.revision,
      stateRevision: nextRevision,
    },
  } as const
}
