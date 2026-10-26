import { match } from '@diegogbrisa/ts-match'
import type { AgentLoopInteraction } from '../types/agent-loop-interaction'
import type {
  HiveAttentionCause,
  HiveNextActor,
  HivePendingRequest,
} from '../types/hive-next-actor'
import type { DelegationState } from '../types/session-collaboration'

/** Why the next actor is who it is: what a Hive row's label says. */
export type HiveNextActorReason =
  | 'awaiting-approval'
  | 'awaiting-answer'
  | 'stuck'
  | 'ready-for-review'
  | 'run-failed'
  | 'asked-for-help'
  | 'finished-turn'
  | 'working'
  | 'revising'
  | 'connecting'
  | 'accepted'
  | 'cancelled'

export interface HiveNextActorFacts {
  /** Absent for a Session without a Delegation, such as the Queen. */
  readonly delegationState?: DelegationState | null
  /** Read only while `delegationState` is `needs_attention`; absent reads as a failed Run. */
  readonly attentionCause?: HiveAttentionCause | null
  readonly pendingRequest?: HivePendingRequest | null
  /**
   * The parent will pick the Worker up without the person: it has an active Run, or Follow-ups
   * its running queue will deliver. Derived live, never stored.
   */
  readonly parentWillAct?: boolean
  /** The Worker's Run is starting (live status `connecting`). */
  readonly connecting?: boolean
}

export interface HiveNextActorResult {
  readonly nextActor: HiveNextActor
  readonly reason: HiveNextActorReason
}

function result(nextActor: HiveNextActor, reason: HiveNextActorReason): HiveNextActorResult {
  return { nextActor, reason }
}

function needsAttentionActor(facts: HiveNextActorFacts) {
  // No agent will pick it up: its parent is idle with nothing queued to deliver.
  if (facts.parentWillAct !== true) return result('user', 'stuck')
  return facts.attentionCause === 'worker_request'
    ? result('parent', 'asked-for-help')
    : result('parent', 'run-failed')
}

/**
 * The one rule for who acts next (ADR 0059). The Session Host uses it for the `nextActor` field
 * of the Hive tool, CLI and MCP, and for the Hive's Needs you count; the renderer uses it for the
 * Hive panel's groups and labels, the rail dot, the sidebar and the Session Summary.
 *
 * A parked request comes first, whatever the Delegation state: only the person can answer it.
 * Returns null for a Session with no Delegation and nothing parked, such as an idle Queen.
 */
export function hiveNextActor(facts: HiveNextActorFacts): HiveNextActorResult | null {
  if (facts.pendingRequest === 'approval') return result('user', 'awaiting-approval')
  if (facts.pendingRequest === 'question') return result('user', 'awaiting-answer')
  const state = facts.delegationState
  if (state === undefined || state === null) return null
  return match(state)
    .with('accepted', () => result('none', 'accepted'))
    .with('cancelled', () => result('none', 'cancelled'))
    .with('needs_attention', () => needsAttentionActor(facts))
    .with('ready_for_review', () => result('parent', 'ready-for-review'))
    .with('waiting', () => result('parent', 'finished-turn'))
    .with('revision_requested', () => result('worker', 'revising'))
    .with('working', () => result('worker', facts.connecting === true ? 'connecting' : 'working'))
    .exhaustive()
}

/**
 * What a parked interaction asks of the person: an authorization confirmation is an approval,
 * any other non-notify interaction is a question. A notification asks for nothing.
 */
export function hivePendingRequestOf(
  interaction: Pick<AgentLoopInteraction, 'kind'> & { readonly purpose?: string },
): HivePendingRequest | null {
  if (interaction.kind === 'notify') return null
  return interaction.kind === 'confirm' && interaction.purpose === 'authorization'
    ? 'approval'
    : 'question'
}

/** Several parked requests on one Session: an approval outranks a question. */
export function strongerPendingRequest(
  current: HivePendingRequest | null | undefined,
  next: HivePendingRequest | null,
): HivePendingRequest | null {
  if (current === 'approval' || next === 'approval') return 'approval'
  return next ?? current ?? null
}
