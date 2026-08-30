import { matchBy } from '@diegogbrisa/ts-match'
import type { FollowUpId, RunId } from '@shared/types/brand'
import type {
  PauseFollowUpQueue,
  ReorderFollowUps,
  ResumeFollowUpQueue,
  WithdrawFollowUp,
} from './follow-up-queue'
import { mutateFollowUpQueue } from './follow-up-queue'
import type { SessionControlSessionState } from './message-aggregate'

const STATE_REVISION_INCREMENT = 1

export type SessionControlQueueMutation =
  | WithdrawFollowUp
  | ReorderFollowUps
  | PauseFollowUpQueue
  | ResumeFollowUpQueue
  | {
      readonly type: 'update-authorization'
      readonly followUpId: FollowUpId
      readonly callerId: string
      readonly runAuthorizationOverride: 'yolo' | 'ask-for-approval' | null
    }

type QueueMutationOperation =
  | 'queue-withdraw'
  | 'queue-reorder'
  | 'queue-pause'
  | 'queue-resume'
  | 'queue-update-authorization'

export type ApplyQueueMutationResult =
  | {
      readonly accepted: true
      readonly state: SessionControlSessionState
      readonly outcome: {
        readonly operation: QueueMutationOperation
        readonly effect: 'queue-updated'
        readonly sessionId: SessionControlSessionState['sessionId']
        readonly queueState: 'running' | 'paused'
        readonly queueRevision: number
        readonly followUpIds: readonly string[]
        readonly stateRevision: number
      }
    }
  | {
      readonly accepted: true
      readonly state: SessionControlSessionState
      readonly outcome: {
        readonly operation: 'queue-resume'
        readonly effect: 'started-run'
        readonly sessionId: SessionControlSessionState['sessionId']
        readonly runId: RunId
        readonly followUpId: FollowUpId
        readonly queueRevision: number
        readonly stateRevision: number
      }
    }
  | {
      readonly accepted: false
      readonly code:
        | 'queue_revision_changed'
        | 'follow_up_already_exists'
        | 'follow_up_not_found'
        | 'queue_order_mismatch'
        | 'queue_already_paused'
        | 'queue_already_running'
      readonly currentRevision: number
      readonly state: SessionControlSessionState
    }

export interface ApplyQueueMutationInput {
  readonly state: SessionControlSessionState
  readonly mutation: SessionControlQueueMutation
  readonly nextRunId: RunId
}

function operationForMutation(mutation: SessionControlQueueMutation): QueueMutationOperation {
  return matchBy(mutation, 'type')
    .with('withdraw', () => 'queue-withdraw')
    .with('reorder', () => 'queue-reorder')
    .with('pause', () => 'queue-pause')
    .with('resume', () => 'queue-resume')
    .with('update-authorization', () => 'queue-update-authorization')
    .exhaustive()
}

function applyAuthorizationUpdate(
  input: ApplyQueueMutationInput,
  mutation: Extract<SessionControlQueueMutation, { type: 'update-authorization' }>,
): ApplyQueueMutationResult {
  const itemIndex = input.state.followUpQueue.items.findIndex(
    (item) => item.id === mutation.followUpId,
  )
  const selected = input.state.followUpQueue.items[itemIndex]
  if (!selected) {
    return {
      accepted: false,
      code: 'follow_up_not_found',
      currentRevision: input.state.followUpQueue.revision,
      state: input.state,
    }
  }
  const { runAuthorizationOverride: _previous, ...baseIntent } = selected.intent
  const { attentionReason: _reason, ...baseFollowUp } = selected
  const items = [...input.state.followUpQueue.items]
  items[itemIndex] = {
    ...baseFollowUp,
    deliveryState: 'pending',
    intent: {
      ...baseIntent,
      callerId: mutation.callerId,
      ...(mutation.runAuthorizationOverride
        ? { runAuthorizationOverride: mutation.runAuthorizationOverride }
        : {}),
    },
  }
  const queueRevision = input.state.followUpQueue.revision + STATE_REVISION_INCREMENT
  const stateRevision = input.state.revision + STATE_REVISION_INCREMENT
  const state = {
    ...input.state,
    revision: stateRevision,
    followUpQueue: { ...input.state.followUpQueue, revision: queueRevision, items },
  }
  return {
    accepted: true,
    state,
    outcome: {
      operation: 'queue-update-authorization',
      effect: 'queue-updated',
      sessionId: state.sessionId,
      queueState: state.followUpQueue.state,
      queueRevision,
      followUpIds: items.map((item) => item.id),
      stateRevision,
    },
  }
}

export function applyQueueMutation(input: ApplyQueueMutationInput): ApplyQueueMutationResult {
  if (input.mutation.type === 'update-authorization') {
    return applyAuthorizationUpdate(input, input.mutation)
  }
  const queueResult = mutateFollowUpQueue(input.state.followUpQueue, input.mutation)
  if (!queueResult.accepted) return { ...queueResult, state: input.state }

  const nextRevision = input.state.revision + STATE_REVISION_INCREMENT
  const nextFollowUp = queueResult.queue.items[0]
  if (
    input.mutation.type === 'resume' &&
    input.state.run.state === 'idle' &&
    nextFollowUp?.deliveryState === 'pending'
  ) {
    const queueRevision = queueResult.queue.revision + STATE_REVISION_INCREMENT
    return {
      accepted: true,
      state: {
        ...input.state,
        revision: nextRevision,
        run: { state: 'starting', runId: input.nextRunId, intent: nextFollowUp.intent },
        followUpQueue: {
          ...queueResult.queue,
          revision: queueRevision,
          items: queueResult.queue.items.slice(1),
        },
      },
      outcome: {
        operation: 'queue-resume',
        effect: 'started-run',
        sessionId: input.state.sessionId,
        runId: input.nextRunId,
        followUpId: nextFollowUp.id,
        queueRevision,
        stateRevision: nextRevision,
      },
    }
  }
  return {
    accepted: true,
    state: {
      ...input.state,
      revision: nextRevision,
      followUpQueue: queueResult.queue,
    },
    outcome: {
      operation: operationForMutation(input.mutation),
      effect: 'queue-updated',
      sessionId: input.state.sessionId,
      queueState: queueResult.queue.state,
      queueRevision: queueResult.queue.revision,
      followUpIds: queueResult.queue.items.map((item) => item.id),
      stateRevision: nextRevision,
    },
  }
}
