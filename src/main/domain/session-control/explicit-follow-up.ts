import type { FollowUpId } from '@shared/types/brand'
import { mutateFollowUpQueue } from './follow-up-queue'
import type {
  SessionControlFollowUp,
  SessionControlIntentSnapshot,
  SessionControlSessionState,
} from './message-aggregate'

const STATE_REVISION_INCREMENT = 1

export type ApplyExplicitFollowUpResult =
  | {
      readonly accepted: true
      readonly state: SessionControlSessionState
      readonly outcome: {
        readonly operation: 'follow-up'
        readonly effect: 'queued-follow-up'
        readonly sessionId: SessionControlSessionState['sessionId']
        readonly followUpId: FollowUpId
        readonly queueRevision: number
        readonly stateRevision: number
      }
    }
  | {
      readonly accepted: false
      readonly code: 'follow_up_already_exists'
      readonly state: SessionControlSessionState
    }

export interface ApplyExplicitFollowUpInput {
  readonly state: SessionControlSessionState
  readonly followUpId: FollowUpId
  readonly intent: SessionControlIntentSnapshot
}

export function applyExplicitFollowUp(
  input: ApplyExplicitFollowUpInput,
): ApplyExplicitFollowUpResult {
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
    return { accepted: false, code: 'follow_up_already_exists', state: input.state }
  }

  const nextRevision = input.state.revision + STATE_REVISION_INCREMENT
  return {
    accepted: true,
    state: {
      ...input.state,
      revision: nextRevision,
      followUpQueue: queueResult.queue,
    },
    outcome: {
      operation: 'follow-up',
      effect: 'queued-follow-up',
      sessionId: input.state.sessionId,
      followUpId: input.followUpId,
      queueRevision: queueResult.queue.revision,
      stateRevision: nextRevision,
    },
  }
}
