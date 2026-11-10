import type { FollowUpId, RunId } from '@shared/types/brand'
import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import { mutateFollowUpQueue, queuedFollowUpQueueState } from './follow-up-queue'
import type {
  SessionControlFollowUp,
  SessionControlIntentSnapshot,
  SessionControlSessionState,
} from './message-aggregate'
import { isPersonStartedRun } from './person-started-run'

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
            readonly queueState: 'running' | 'paused'
            readonly pauseReason?: FollowUpQueuePauseReason
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

/**
 * An idle Session starts the Follow-up at once when nothing is queued ahead of it, or when the
 * person sends it to a queue that waits only on agents' capacity (`parent-limit`): the person's
 * work never waits behind agents' work, so it starts ahead of the held agents' Follow-ups, which
 * stay paused (ADR 0030, amended 2026-11-10). Anything else joins the queue.
 */
function startsAtOnce(input: ApplyExplicitFollowUpInput) {
  const { run, followUpQueue: queue } = input.state
  if (run.state !== 'idle') return false
  if (queue.state === 'running') return queue.items.length === 0
  return queue.pauseReason === 'parent-limit' && isPersonStartedRun(input.intent)
}

export function applyExplicitFollowUp(
  input: ApplyExplicitFollowUpInput,
): ApplyExplicitFollowUpResult {
  if (startsAtOnce(input)) {
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
      ...queuedFollowUpQueueState(queueResult.queue),
      queueRevision: queueResult.queue.revision,
      stateRevision: nextRevision,
    },
  }
}
