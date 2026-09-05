import type { FollowUpId, RunId } from '@shared/types/brand'
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
      readonly outcome:
        | {
            readonly operation: 'follow-up'
            readonly effect: 'started-run'
            readonly sessionId: SessionControlSessionState['sessionId']
            readonly runId: RunId
            readonly stateRevision: number
          }
        | {
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
      readonly code:
        | 'follow_up_already_exists'
        | 'queue_capacity_reached'
        | 'queue_byte_capacity_reached'
      readonly state: SessionControlSessionState
    }

export interface ApplyExplicitFollowUpInput {
  readonly state: SessionControlSessionState
  readonly runId: RunId
  readonly followUpId: FollowUpId
  readonly intent: SessionControlIntentSnapshot
}

export function applyExplicitFollowUp(
  input: ApplyExplicitFollowUpInput,
): ApplyExplicitFollowUpResult {
  if (
    input.state.run.state === 'idle' &&
    input.state.followUpQueue.state === 'running' &&
    input.state.followUpQueue.items.length === 0
  ) {
    const nextRevision = input.state.revision + STATE_REVISION_INCREMENT
    return {
      accepted: true,
      state: {
        ...input.state,
        revision: nextRevision,
        run: { state: 'starting', runId: input.runId, intent: input.intent },
      },
      outcome: {
        operation: 'follow-up',
        effect: 'started-run',
        sessionId: input.state.sessionId,
        runId: input.runId,
        stateRevision: nextRevision,
      },
    }
  }

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
    return { accepted: false, code: queueResult.code, state: input.state }
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
