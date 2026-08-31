import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import type { ThinkingLevel } from '@shared/types/settings'
import { type FollowUpQueue, type FollowUpQueueItem, mutateFollowUpQueue } from './follow-up-queue'
import { planMessageSubmission, type SessionRunAvailability } from './message-submission'

const STATE_REVISION_INCREMENT = 1

export interface SessionControlIntentSnapshot {
  readonly text: string
  readonly attachmentIds: readonly string[]
  readonly thinkingLevel?: ThinkingLevel
  readonly runAuthorizationOverride?: AgentAuthorizationMode
  readonly interactionTimeoutMs?: number
  readonly callerId: string
  readonly acceptedAt: number
  readonly idempotencyKey: string
}

export interface SessionControlFollowUp extends FollowUpQueueItem {
  readonly intent: SessionControlIntentSnapshot
  readonly deliveryState: 'pending' | 'needs_attention'
  readonly attentionReason?:
    | 'authorization_ceiling_changed'
    | 'profile_revoked'
    | 'authority_changed'
}

export type SessionControlRunState =
  | { readonly state: 'idle' }
  | {
      readonly state: 'starting'
      readonly runId: RunId
      readonly intent: SessionControlIntentSnapshot
    }
  | { readonly state: 'active'; readonly runId: RunId }
  | { readonly state: 'stopping'; readonly runId: RunId }

export interface SessionControlSessionState {
  readonly sessionId: SessionId
  readonly revision: number
  readonly run: SessionControlRunState
  readonly followUpQueue: FollowUpQueue<SessionControlFollowUp>
}

export interface AdaptiveMessageIdentities {
  readonly runId: RunId
  readonly followUpId: FollowUpId
}

export type AdaptiveMessageOutcome =
  | {
      readonly operation: 'message'
      readonly effect: 'started-run'
      readonly sessionId: SessionId
      readonly runId: RunId
      readonly stateRevision: number
    }
  | {
      readonly operation: 'message'
      readonly effect: 'queued-follow-up'
      readonly sessionId: SessionId
      readonly followUpId: FollowUpId
      readonly queueRevision: number
      readonly stateRevision: number
    }

export type ApplyAdaptiveMessageResult =
  | {
      readonly accepted: true
      readonly state: SessionControlSessionState
      readonly outcome: AdaptiveMessageOutcome
    }
  | {
      readonly accepted: false
      readonly code: 'follow_up_already_exists'
      readonly state: SessionControlSessionState
    }

export interface ApplyAdaptiveMessageInput {
  readonly state: SessionControlSessionState
  readonly identities: AdaptiveMessageIdentities
  readonly intent: SessionControlIntentSnapshot
}

function toRunAvailability(run: SessionControlRunState): SessionRunAvailability {
  return matchBy(run, 'state')
    .with('idle', () => ({ state: 'idle' }))
    .with('starting', ({ runId }) => ({ state: 'starting', runId }))
    .with('active', ({ runId }) => ({ state: 'active', runId }))
    .with('stopping', ({ runId }) => ({ state: 'stopping', runId }))
    .exhaustive()
}

export function applyAdaptiveMessage(input: ApplyAdaptiveMessageInput): ApplyAdaptiveMessageResult {
  const plan = planMessageSubmission({
    run: toRunAvailability(input.state.run),
    followUpQueue: { pendingCount: input.state.followUpQueue.items.length },
  })

  return matchBy(plan, 'action')
    .with('start-run', () => {
      const nextRevision = input.state.revision + STATE_REVISION_INCREMENT
      return {
        accepted: true,
        state: {
          ...input.state,
          revision: nextRevision,
          run: {
            state: 'starting',
            runId: input.identities.runId,
            intent: input.intent,
          },
        },
        outcome: {
          operation: 'message',
          effect: 'started-run',
          sessionId: input.state.sessionId,
          runId: input.identities.runId,
          stateRevision: nextRevision,
        },
      }
    })
    .with('append-follow-up', () => {
      const followUp: SessionControlFollowUp = {
        id: input.identities.followUpId,
        intent: input.intent,
        deliveryState: 'pending',
      }
      const queueResult = mutateFollowUpQueue(input.state.followUpQueue, {
        type: 'append',
        item: followUp,
      })
      if (!queueResult.accepted) {
        return {
          accepted: false,
          code: 'follow_up_already_exists',
          state: input.state,
        }
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
          operation: 'message',
          effect: 'queued-follow-up',
          sessionId: input.state.sessionId,
          followUpId: input.identities.followUpId,
          queueRevision: queueResult.queue.revision,
          stateRevision: nextRevision,
        },
      }
    })
    .exhaustive()
}
