import type {
  LocalSessionAuthorityLimits,
  LocalSessionCallerIdentity,
} from '@shared/types/local-session-profile'
import type { ScheduledTaskCreator } from '@shared/types/scheduled-task'
import { DEFAULT_SESSION_AGENT_CAPABILITIES } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import {
  isLocalUserCallerId,
  isProfileCallerId,
  parseSessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'
import { ScheduledTaskRepository } from '../ports/scheduled-task-repository'
import { NO_AUTHORITY_LIMITS } from './local-session-authority-limits'

/** The owner key of the local user's tasks, whichever local client created them. */
export const LOCAL_USER_TASK_OWNER = 'local-user'

/**
 * Who is asking, for Scheduled tasks: whose tasks they see (`ownerKey`), who they are
 * (`creator`), and the caller a task they create runs as (`creatorCallerId`), whose authority each
 * run revalidates (ADR 0058). The local user, from the desktop app or the CLI, sees and manages
 * every task; a CLI client profile only its own, and a Session agent those of the local user or
 * profile its Session acts for. A task a Session agent creates runs as that owner, within the
 * agent's own authority (`authorityLimits`), so it does not depend on the agent's Session.
 */
export interface ScheduledTaskPrincipal {
  readonly caller: LocalSessionCallerIdentity
  readonly ownerKey: string
  readonly creatorCallerId: string
  readonly authorityLimits: LocalSessionAuthorityLimits | null
  readonly creator: ScheduledTaskCreator
  readonly workingDirectory: string | null
  readonly localUser: boolean
}

export type ScheduledTaskPrincipalResolution =
  | { readonly supported: true; readonly principal: ScheduledTaskPrincipal }
  | { readonly supported: false; readonly message: string }

function ownerKeyOfOrigin(originCallerId: string) {
  return isLocalUserCallerId(originCallerId) ? LOCAL_USER_TASK_OWNER : originCallerId
}

/**
 * The authority a Session agent held, as limits a task it creates runs within. An agent whose
 * Session acts for the local user and holds all of it (every default capability, every project,
 * yolo) needs none, so its task runs exactly as one the user created. Anything narrower, and any
 * agent acting for a CLI client profile, keeps its limits.
 */
export function sessionAgentAuthorityLimits(
  caller: LocalSessionCallerIdentity,
  originCallerId: string,
) {
  const authority = caller.profileAuthority
  // An agent caller always carries its authority; one without it is held to nothing.
  if (!authority) return NO_AUTHORITY_LIMITS
  const scope = caller.baseProfileScope ?? authority.scope
  const whole =
    isLocalUserCallerId(originCallerId) &&
    scope.all === true &&
    authority.authorizationCeiling === 'yolo' &&
    DEFAULT_SESSION_AGENT_CAPABILITIES.every((capability) =>
      authority.capabilities.includes(capability),
    )
  if (whole) return null
  return {
    capabilities: [...authority.capabilities],
    scope,
    authorizationCeiling: authority.authorizationCeiling,
  } satisfies LocalSessionAuthorityLimits
}

export function resolveScheduledTaskPrincipal(caller: LocalSessionCallerIdentity) {
  return Effect.gen(function* () {
    const workingDirectory = caller.workingDirectory ?? null
    if (isLocalUserCallerId(caller.callerId)) {
      return {
        supported: true,
        principal: {
          caller,
          ownerKey: LOCAL_USER_TASK_OWNER,
          creatorCallerId: caller.callerId,
          authorityLimits: null,
          creator: { kind: 'local-user', label: 'You' },
          workingDirectory,
          localUser: true,
        },
      } satisfies ScheduledTaskPrincipalResolution
    }
    if (isProfileCallerId(caller.callerId) && caller.profileAuthority) {
      return {
        supported: true,
        principal: {
          caller,
          ownerKey: caller.callerId,
          creatorCallerId: caller.callerId,
          authorityLimits: null,
          creator: { kind: 'profile', label: caller.profileAuthority.profileName },
          workingDirectory,
          localUser: false,
        },
      } satisfies ScheduledTaskPrincipalResolution
    }
    const agent = parseSessionAgentCallerId(caller.callerId)
    if (agent) {
      const repository = yield* ScheduledTaskRepository
      const origin = yield* repository.sessionAuthorityOrigin(agent.sessionId)
      if (!origin) {
        return {
          supported: false,
          message: 'The calling Session was not found.',
        } satisfies ScheduledTaskPrincipalResolution
      }
      const ownerKey = ownerKeyOfOrigin(origin.originCallerId)
      return {
        supported: true,
        principal: {
          caller,
          ownerKey,
          // The owner key is the caller id the task runs as: `local-user` or `profile:<id>`.
          creatorCallerId: ownerKey,
          authorityLimits: sessionAgentAuthorityLimits(caller, origin.originCallerId),
          creator: { kind: 'session-agent', label: origin.title, sessionId: agent.sessionId },
          workingDirectory,
          localUser: false,
        },
      } satisfies ScheduledTaskPrincipalResolution
    }
    return {
      supported: false,
      message:
        'Scheduled tasks need a lasting caller: the local user, a CLI client profile, or a Session agent.',
    } satisfies ScheduledTaskPrincipalResolution
  })
}
