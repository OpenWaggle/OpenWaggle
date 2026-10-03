import { matchBy } from '@diegogbrisa/ts-match'
import type { InlineVisualizationContext } from '@shared/types/agent'
import type { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import type { WaggleInvocation } from '@shared/types/waggle'
import { type FollowUpQueue, type FollowUpQueueItem, mutateFollowUpQueue } from './follow-up-queue'
import { planMessageSubmission, type SessionRunAvailability } from './message-submission'
import {
  type RunStartSettings,
  type RunStartSettingsRejection,
  refuseRunStartSettings,
  withRunStartSettings,
} from './run-start-settings'

const STATE_REVISION_INCREMENT = 1

/**
 * The Follow-up intent snapshot: message content and who sent it. It carries no thinking level and
 * no Run authorization override; a Run uses the Session's settings when it starts.
 */
export interface SessionControlIntentSnapshot {
  readonly text: string
  readonly attachmentIds: readonly string[]
  readonly waggle?: WaggleInvocation
  readonly visualizationContext?: InlineVisualizationContext
  readonly interactionTimeoutMs?: number
  readonly callerId: string
  /**
   * Who queued the Follow-up, when the desktop user later adopted it (`queue-adopt` makes the
   * adopter `callerId`). Provenance only: the Run acts under `callerId`. Its attachments stay owned
   * by this author.
   */
  readonly authorCallerId?: string
  readonly acceptedAt: number
  readonly idempotencyKey: string
  /**
   * Set on a Follow-up that a direct Steering message became when its Run stopped before
   * incorporating it: the Run it was steered into. `idempotencyKey` and `callerId` are the steer's,
   * so its caller can find it in the queue instead of sending it again.
   */
  readonly returnedSteer?: { readonly runId: string }
}

/**
 * Who owns a Follow-up's attachments: its author. After `queue-adopt` the adopter is `callerId`,
 * but the attachment rows stay owned by whoever queued it (`authorCallerId`). Every resolve or
 * release of a Follow-up's attachments must use this owner.
 */
export function followUpAttachmentOwner(
  intent: Pick<SessionControlIntentSnapshot, 'callerId' | 'authorCallerId'>,
): string {
  return intent.authorCallerId ?? intent.callerId
}

/**
 * A Follow-up edit hold: the Host-owned lease that stops queue delivery at this Follow-up while
 * its author edits it. It belongs to the item, so it travels with the item when the queue is
 * reordered. It is lease state, not part of the intent snapshot (see `follow-up-edit.ts`).
 */
export interface SessionControlFollowUpEditHold {
  readonly holdId: string
  readonly holderCallerId: string
  /** Wall-clock acquisition time, for display. */
  readonly acquiredAt: number
  /**
   * Host sweeps since the last renewal (see `follow-up-edit-lease.ts`); a hold that reaches the
   * lease is gone. Renewal clears it without a queue revision.
   */
  readonly missedSweeps: number
  /** The queue revision the edit began at; a save names it (see `saveFollowUpEdit`). */
  readonly baseQueueRevision: number
}

/** What a starting Run runs: its Follow-up intent snapshot plus any settings it was started with. */
export type SessionControlRunIntent = SessionControlIntentSnapshot & RunStartSettings

export interface SessionControlFollowUp extends FollowUpQueueItem {
  readonly intent: SessionControlIntentSnapshot
  readonly deliveryState: 'pending' | 'needs_attention'
  readonly attentionReason?: 'profile_revoked' | 'authority_changed'
  readonly editHold?: SessionControlFollowUpEditHold
}

export type SessionControlRunState =
  | { readonly state: 'idle' }
  | {
      readonly state: 'starting'
      readonly runId: RunId
      readonly intent: SessionControlRunIntent
    }
  | { readonly state: 'active'; readonly runId: RunId }
  | { readonly state: 'stopping'; readonly runId: RunId }

export interface SessionControlSessionState {
  readonly sessionId: SessionId
  readonly revision: number
  readonly run: SessionControlRunState
  readonly followUpQueue: FollowUpQueue<SessionControlFollowUp>
}

export type { RunStartSettings } from './run-start-settings'

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
      readonly code:
        | 'follow_up_already_exists'
        | 'queue_capacity_reached'
        | 'queue_byte_capacity_reached'
        | RunStartSettingsRejection
      readonly state: SessionControlSessionState
    }

export interface ApplyAdaptiveMessageInput {
  readonly state: SessionControlSessionState
  readonly identities: AdaptiveMessageIdentities
  readonly intent: SessionControlIntentSnapshot
  /** Allowed only when the message starts a Run; a message that would be queued is refused. */
  readonly runSettings?: RunStartSettings
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
    followUpQueue: {
      pendingCount: input.state.followUpQueue.items.length,
      state: input.state.followUpQueue.state,
      headDeliverable: input.state.followUpQueue.items[0]?.deliveryState === 'pending',
      headHeld: input.state.followUpQueue.items[0]?.editHold !== undefined,
    },
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
            intent: withRunStartSettings(input.intent, input.runSettings),
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
    .with('append-follow-up', (): ApplyAdaptiveMessageResult => {
      const refused = refuseRunStartSettings(input.runSettings)
      if (refused) return { accepted: false, code: refused, state: input.state }
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
        if (
          queueResult.code !== 'follow_up_already_exists' &&
          queueResult.code !== 'queue_capacity_reached' &&
          queueResult.code !== 'queue_byte_capacity_reached'
        ) {
          throw new Error(`Unexpected Follow-up append rejection: ${queueResult.code}`)
        }
        return {
          accepted: false,
          code: queueResult.code,
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
