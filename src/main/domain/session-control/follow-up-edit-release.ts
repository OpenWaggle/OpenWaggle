import type { FollowUpId, RunId } from '@shared/types/brand'
import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import type { SessionControlFollowUp, SessionControlSessionState } from './message-aggregate'

const REVISION_INCREMENT = 1

export interface QueueOutcomeBase {
  readonly sessionId: SessionControlSessionState['sessionId']
  readonly queueRevision: number
  readonly stateRevision: number
}

export type FollowUpEditReleaseOutcome =
  | (QueueOutcomeBase & {
      readonly operation: 'queue-edit-save' | 'queue-edit-cancel'
      readonly effect: 'queue-updated'
      readonly queueState: 'running' | 'paused'
      readonly followUpIds: readonly string[]
    })
  | (QueueOutcomeBase & {
      readonly operation: 'queue-edit-save' | 'queue-edit-cancel'
      readonly effect: 'started-run'
      readonly runId: RunId
      readonly followUpId: FollowUpId
    })

/** A held item blocks delivery of itself and of every item behind it. */
export function isFollowUpEditHeld(item: SessionControlFollowUp | undefined) {
  return item?.editHold !== undefined
}

function queueUpdated(
  state: SessionControlSessionState,
  operation: 'queue-edit-save' | 'queue-edit-cancel',
) {
  return {
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
  } as const
}

/**
 * After a hold is released the queue delivers again under the resumption rule: an idle Session with
 * a running queue whose head is pending and not held starts that head now. When the Host cannot
 * admit that Run (`deferDelivery`), the queue pauses instead, so it never sits idle and runnable
 * with nothing to start it, and a later message starts a Run rather than queueing behind it.
 */
export function releasedOutcome(
  state: SessionControlSessionState,
  operation: 'queue-edit-save' | 'queue-edit-cancel',
  nextRunId: RunId,
  deferDelivery: FollowUpQueuePauseReason | undefined,
): { readonly state: SessionControlSessionState; readonly outcome: FollowUpEditReleaseOutcome } {
  const head = state.followUpQueue.items[0]
  if (
    state.run.state === 'idle' &&
    state.followUpQueue.state === 'running' &&
    head?.deliveryState === 'pending' &&
    !isFollowUpEditHeld(head)
  ) {
    if (deferDelivery) {
      return queueUpdated(
        {
          ...state,
          revision: state.revision + REVISION_INCREMENT,
          followUpQueue: {
            ...state.followUpQueue,
            state: 'paused',
            pauseReason: deferDelivery,
            revision: state.followUpQueue.revision + REVISION_INCREMENT,
          },
        },
        operation,
      )
    }
    const queueRevision = state.followUpQueue.revision + REVISION_INCREMENT
    const started: SessionControlSessionState = {
      ...state,
      revision: state.revision + REVISION_INCREMENT,
      run: { state: 'starting', runId: nextRunId, intent: head.intent },
      followUpQueue: {
        ...state.followUpQueue,
        revision: queueRevision,
        items: state.followUpQueue.items.slice(1),
      },
    }
    return {
      state: started,
      outcome: {
        operation,
        effect: 'started-run',
        sessionId: state.sessionId,
        runId: nextRunId,
        followUpId: head.id,
        queueRevision,
        stateRevision: started.revision,
      },
    }
  }
  return queueUpdated(state, operation)
}
