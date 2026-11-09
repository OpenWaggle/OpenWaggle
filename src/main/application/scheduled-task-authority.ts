import type { LocalSessionAuthorityLimits } from '@shared/types/local-session-profile'
import type { ScheduledTaskPatch, ScheduledTaskTarget } from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import {
  type ScheduledTaskRecord,
  ScheduledTaskRepository,
} from '../ports/scheduled-task-repository'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { intersectReachableAuthorityLimits } from './local-session-authority-limits'
import { rejectedOutcome } from './scheduled-task-heartbeat-settings'
import { LOCAL_USER_TASK_OWNER, type ScheduledTaskPrincipal } from './scheduled-task-principal'
import { authorizeScheduledTaskTarget } from './scheduled-task-target-authorization'

const HEARTBEAT_REMEDY =
  'Its owner can change its prompt, Session, stop condition or Wake check to run it with their own access.'

/**
 * Why a Heartbeat held to `limits` may not wake its Session, or null. Its Run starts as the
 * task's owner, and the agent working in that Run takes its reach and Authorization ceiling from
 * both the owner and its own Session. When those exceed the limits (every project for an agent
 * held to fewer, YOLO for an agent held to ask-for-approval), the Run would do more than the agent
 * that created the task could, so the Heartbeat is refused instead (ADR 0058 amendment).
 */
export function heartbeatBoundaryRefusal(input: {
  readonly ownerCallerId: string
  readonly limits: LocalSessionAuthorityLimits | null
  readonly sessionId: string
}) {
  return Effect.gen(function* () {
    const { limits } = input
    if (!limits) return null
    const repository = yield* ScheduledTaskRepository
    const target = yield* repository.sessionAuthorityBoundary(input.sessionId)
    if (!target) return null
    const owner = yield* repository.callerAuthorityBoundary(input.ownerCallerId)
    if (limits.scope.all !== true && owner.reachesEveryProject && target.reachesEveryProject) {
      return `This Heartbeat runs within an agent's access, which does not reach every project, but its Session does. ${HEARTBEAT_REMEDY}`
    }
    if (
      limits.authorizationCeiling === 'ask-for-approval' &&
      owner.authorizationCeiling === 'yolo' &&
      target.authorizationCeiling === 'yolo'
    ) {
      return `This Heartbeat runs within an agent's access, which has to ask for approval, but its Session runs in YOLO mode. ${HEARTBEAT_REMEDY}`
    }
    return null
  })
}

/**
 * Why a changed Heartbeat may not run as it now would, or null: checked when the edit changes its
 * Session or the limits it runs within, whoever made the edit.
 */
export function changedHeartbeatBoundaryRefusal(
  current: Pick<ScheduledTaskRecord, 'target' | 'creatorCallerId' | 'authorityLimits'>,
  next: Pick<ScheduledTaskRecord, 'target' | 'creatorCallerId' | 'authorityLimits'>,
) {
  if (next.target.kind !== 'heartbeat') return Effect.succeed(null)
  const unchanged =
    JSON.stringify(current.target) === JSON.stringify(next.target) &&
    current.creatorCallerId === next.creatorCallerId &&
    JSON.stringify(current.authorityLimits) === JSON.stringify(next.authorityLimits)
  if (unchanged) return Effect.succeed(null)
  return heartbeatBoundaryRefusal({
    ownerCallerId: next.creatorCallerId,
    limits: next.authorityLimits,
    sessionId: next.target.sessionId,
  })
}

/** The refusal for a Launch schedule a catalog-wide agent aims at a project OpenWaggle does not know. */
export const UNKNOWN_LAUNCH_PROJECT_MESSAGE =
  'An agent can only schedule launches in a project that already has a Session or Workspace in OpenWaggle.'

/**
 * Whether a Launch schedule an agent created must target a project OpenWaggle already knows: a
 * catalog-wide agent may name any path, so it is held to the project catalog, as the Hive tool
 * holds its own launches (ADR 0042). A narrower agent's scope already refuses other projects.
 */
export function launchNeedsKnownProject(
  creator: Pick<ScheduledTaskRecord['creator'], 'kind'>,
  scope: { readonly all?: boolean } | undefined,
) {
  return creator.kind === 'session-agent' && (scope === undefined || scope.all === true)
}

/**
 * What an agent may not schedule even where it could send the request by hand: a launch into a
 * project OpenWaggle does not know, or a Heartbeat whose Run would exceed the agent's authority.
 */
function agentTargetRefusal(principal: ScheduledTaskPrincipal, target: ScheduledTaskTarget) {
  return Effect.gen(function* () {
    const repository = yield* ScheduledTaskRepository
    if (target.kind === 'launch') {
      const scope = principal.caller.baseProfileScope ?? principal.caller.profileAuthority?.scope
      if (!launchNeedsKnownProject(principal.creator, scope)) return null
      if (yield* repository.projectKnown(target.projectPath)) return null
      return { code: 'target_not_found', message: UNKNOWN_LAUNCH_PROJECT_MESSAGE } as const
    }
    const message = yield* heartbeatBoundaryRefusal({
      ownerCallerId: principal.creatorCallerId,
      limits: principal.authorityLimits,
      sessionId: target.sessionId,
    })
    return message ? ({ code: 'target_scope_denied', message } as const) : null
  })
}

function changesWork(
  current: Pick<ScheduledTaskRecord, 'prompt' | 'target'>,
  patch: ScheduledTaskPatch,
) {
  return (
    (patch.prompt !== undefined && patch.prompt !== current.prompt) ||
    (patch.target !== undefined &&
      JSON.stringify(patch.target) !== JSON.stringify(current.target)) ||
    patch.heartbeat?.wakeCheck !== undefined ||
    // The Heartbeat Run's agent reads its stop condition and acts on it.
    patch.heartbeat?.stopWhen !== undefined
  )
}

/**
 * Who a task runs as once it is changed. Turning it on or off, or rescheduling it, changes
 * nothing. When a task's owner (the local user, or the CLI client profile whose task it is)
 * changes its prompt, target, stop condition or Wake check, it runs as them with their whole
 * authority from then on, though an agent created it with less. When a Session agent changes
 * them, the task keeps only what both it and the agent may do, so an agent cannot have a task
 * with more authority run what it wrote (ADR 0058 amendment).
 */
export function runsAsAfterUpdate(
  principal: ScheduledTaskPrincipal,
  current: Pick<
    ScheduledTaskRecord,
    'ownerKey' | 'creatorCallerId' | 'authorityLimits' | 'workByAgent' | 'prompt' | 'target'
  >,
  patch: ScheduledTaskPatch,
) {
  return Effect.gen(function* () {
    const kept = {
      creatorCallerId: current.creatorCallerId,
      authorityLimits: current.authorityLimits,
      workByAgent: current.workByAgent,
    }
    if (!changesWork(current, patch)) return kept
    // Whoever changes its work now wrote what it runs.
    const workByAgent = !principal.localUser
    if (principal.localUser) {
      return current.ownerKey === LOCAL_USER_TASK_OWNER
        ? { creatorCallerId: principal.creatorCallerId, authorityLimits: null, workByAgent }
        : { ...kept, workByAgent }
    }
    if (!principal.authorityLimits) {
      // Only the owning profile itself: an unrestricted Session agent also has no limits, and its
      // edit must not lift the limits another agent's prompt runs within.
      return principal.creator.kind === 'profile' && principal.creatorCallerId === current.ownerKey
        ? { creatorCallerId: principal.creatorCallerId, authorityLimits: null, workByAgent }
        : { ...kept, workByAgent }
    }
    return {
      creatorCallerId: current.creatorCallerId,
      authorityLimits: yield* intersectReachableAuthorityLimits(
        current.authorityLimits,
        principal.authorityLimits,
      ),
      workByAgent,
    }
  })
}

/** The target's project, after checking the caller could send its run request by hand. */
export function admitTarget(principal: ScheduledTaskPrincipal, target: ScheduledTaskTarget) {
  return Effect.gen(function* () {
    let projectPath: string | null = target.kind === 'launch' ? target.projectPath : null
    if (target.kind === 'heartbeat') {
      const targets = yield* SessionAuthorizationTargetRepository
      const resolved = yield* targets.resolve(target.sessionId).pipe(Effect.option)
      if (resolved._tag === 'None') {
        return rejectedOutcome('target_not_found', 'That Session was not found.')
      }
      projectPath = resolved.value.projectPath
    }
    const authorization = yield* authorizeScheduledTaskTarget(principal.caller, target)
    if (!authorization.authorized) {
      return rejectedOutcome(authorization.code, authorization.message)
    }
    const refusal = yield* agentTargetRefusal(principal, target)
    if (refusal) return rejectedOutcome(refusal.code, refusal.message)
    return { effect: 'admitted', projectPath } as const
  })
}
