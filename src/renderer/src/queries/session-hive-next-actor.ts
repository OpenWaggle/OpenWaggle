import { match } from '@diegogbrisa/ts-match'
import {
  type HiveNextActorReason,
  type HiveNextActorResult,
  hiveNextActor,
} from '@shared/domain/hive-next-actor'
import type { HivePendingRequest } from '@shared/types/hive-next-actor'
import type { SessionStatus } from '@shared/types/session-status'
import type { HiveSession } from './session-hive-contract'

/**
 * The Hive's groups by who acts next (ADR 0059): Needs you (the person), Waiting for ‹parent›
 * (the agent that spawned the Worker), Working (the Worker itself) and Closed.
 */
export type HiveNextActorGroup = 'needs-you' | 'waiting' | 'working' | 'closed'

export const HIVE_NEEDS_YOU_LABEL = 'Needs you'

/**
 * A parked request, from the live status when the window knows it: the status follows each
 * request and answer as it happens, while the Host's catalog is read again only on a state change.
 * The catalog says whether it is an approval.
 */
function pendingRequestOf(
  session: HiveSession,
  liveStatus: SessionStatus | undefined,
): HivePendingRequest | null {
  if (liveStatus === undefined) return session.pendingInteractionKind ?? null
  return liveStatus === 'awaiting-input' ? (session.pendingInteractionKind ?? 'question') : null
}

/** Who acts next on a Hive member, by the one shared rule (`hiveNextActor`). */
export function hiveMemberNextActor(
  session: HiveSession,
  liveStatus?: SessionStatus,
): HiveNextActorResult | null {
  const lineage = session.lineage
  return hiveNextActor({
    delegationState: lineage?.delegationState ?? null,
    attentionCause: lineage?.attentionCause ?? null,
    parentWillAct: lineage?.parentWillAct === true,
    pendingRequest: pendingRequestOf(session, liveStatus),
    connecting: liveStatus === 'connecting',
  })
}

/** A member with no next actor yet (a Worker before its Delegation) works on. */
export function hiveNextActorGroup(next: HiveNextActorResult | null): HiveNextActorGroup {
  return match(next?.nextActor ?? 'worker')
    .with('user', () => 'needs-you' as const)
    .with('parent', () => 'waiting' as const)
    .with('worker', () => 'working' as const)
    .with('none', () => 'closed' as const)
    .exhaustive()
}

/** Whether only the person can unblock this member: the rail dot, sidebar and Summary rule. */
export function hiveMemberNeedsYou(session: HiveSession, liveStatus?: SessionStatus) {
  return hiveMemberNextActor(session, liveStatus)?.nextActor === 'user'
}

/** The Worker's parent, named in its labels; the Queen when the lineage does not say. */
export function hiveParentName(session: HiveSession) {
  return session.lineage?.parentTitle?.trim() || 'its parent'
}

/** "Waiting for ‹parent title›": the group heading for Workers whose parent acts next. */
export function hiveWaitingGroupLabel(parentTitle: string) {
  return `Waiting for ${parentTitle}`
}

/** Each reason's row label and its plain-language explanation (ADR 0059). */
export function hiveNextActorLabel(
  reason: HiveNextActorReason,
  parent: string,
): { readonly label: string; readonly hint: string } {
  return match(reason)
    .with('awaiting-approval', () => ({
      label: 'Waiting for your approval',
      hint: 'A Run asked for your approval and waits for it.',
    }))
    .with('awaiting-answer', () => ({
      label: 'Waiting for your answer',
      hint: 'A Run asked you a question and waits for your answer.',
    }))
    .with('stuck', () => ({
      label: 'Stuck — no agent will pick it up',
      hint: `It needs help, but ${parent} has no Run and nothing queued. Only you can unblock it.`,
    }))
    .with('ready-for-review', () => ({
      label: 'Ready for review',
      hint: `The Worker finished; ${parent} reviews its result.`,
    }))
    .with('run-failed', () => ({
      label: `Run failed, ${parent} notified`,
      hint: `Its last Run failed or was interrupted. The Host told ${parent}, which acts next.`,
    }))
    .with('asked-for-help', () => ({
      label: `Asked ${parent} for help`,
      hint: `The Worker asked ${parent} for help and waits for an answer.`,
    }))
    .with('finished-turn', () => ({
      label: 'Finished its turn',
      hint: `The Worker finished its turn and waits for ${parent}.`,
    }))
    .with('working', () => ({
      label: 'Working',
      hint: 'The Worker is carrying out its delegation.',
    }))
    .with('revising', () => ({
      label: 'Revising',
      hint: `The Worker is revising its result, as ${parent} asked.`,
    }))
    .with('connecting', () => ({ label: 'Connecting', hint: 'The Worker’s Run is starting.' }))
    .with('accepted', () => ({ label: 'Accepted', hint: `The result was accepted by ${parent}.` }))
    .with('cancelled', () => ({ label: 'Cancelled', hint: 'The delegation was cancelled.' }))
    .exhaustive()
}
