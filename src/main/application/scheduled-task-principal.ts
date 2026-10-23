import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { ScheduledTaskCreator } from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import {
  isLocalUserCallerId,
  isProfileCallerId,
  parseSessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'
import { ScheduledTaskRepository } from '../ports/scheduled-task-repository'

/** The owner key of the local user's tasks, whichever local client created them. */
export const LOCAL_USER_TASK_OWNER = 'local-user'

/**
 * Who is asking, for Scheduled tasks: whose tasks they see (`ownerKey`) and the identity a task
 * they create keeps, whose authority each run revalidates (ADR 0058). The local user, from the
 * desktop app or the CLI, sees and manages every task; a CLI client profile only its own, and a
 * Session agent those of the local user or profile its Session acts for.
 */
export interface ScheduledTaskPrincipal {
  readonly caller: LocalSessionCallerIdentity
  readonly ownerKey: string
  readonly creatorCallerId: string
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
      return {
        supported: true,
        principal: {
          caller,
          ownerKey: ownerKeyOfOrigin(origin.originCallerId),
          creatorCallerId: caller.callerId,
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
