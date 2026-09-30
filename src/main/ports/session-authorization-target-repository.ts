import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'
import type { SessionCapability } from '@shared/types/session-capability'
import { Context, type Effect } from 'effect'
import type { SessionAuthorizationTargetRepositoryError } from '../errors'

export interface SessionAuthorizationTarget {
  readonly sessionId: string
  readonly projectPath: string
  readonly workingPath?: string
  readonly hiveRootSessionId: string
  readonly authorizationCeiling: AgentAuthorizationMode
}

export interface SessionAuthorizationTargetRepositoryShape {
  readonly listActiveDescendantTargets?: (
    ancestorSessionId: string,
  ) => Effect.Effect<
    readonly SessionAuthorizationTarget[],
    SessionAuthorizationTargetRepositoryError
  >
  readonly listAuthorizedSessionIds?: (
    scope: LocalSessionProfileScope,
  ) => Effect.Effect<readonly string[], SessionAuthorizationTargetRepositoryError>
  readonly resolveWorkspaceProjectPaths?: (
    workspaceRoots: readonly string[],
  ) => Effect.Effect<readonly string[], SessionAuthorizationTargetRepositoryError>
  /**
   * Whether input from `callerId` into the Run `runId` of `sessionId` (a steer, a promoted
   * Follow-up, or an answer to a pending request) would come from a caller without the reach
   * that Run has. A Run that reaches every project must not take input from a narrower caller,
   * or that caller could direct it into other projects (ADR 0040).
   */
  readonly runInputWidensReach: (input: {
    readonly callerId: string
    readonly sessionId: string
    readonly runId: string
    readonly followUpId?: string
  }) => Effect.Effect<boolean, SessionAuthorizationTargetRepositoryError>
  readonly resolve: (
    sessionId: string,
  ) => Effect.Effect<SessionAuthorizationTarget, SessionAuthorizationTargetRepositoryError>
  readonly resolveDelegation: (
    delegationId: string,
  ) => Effect.Effect<SessionAuthorizationTarget, SessionAuthorizationTargetRepositoryError>
  readonly listLiveDerivedAuthorities: (
    callerId: string,
    originScope: LocalSessionProfileScope,
  ) => Effect.Effect<
    readonly {
      readonly sessionId: string
      readonly capabilities: readonly SessionCapability[]
      readonly authorizationCeiling: AgentAuthorizationMode
    }[],
    SessionAuthorizationTargetRepositoryError
  >
}

export class SessionAuthorizationTargetRepository extends Context.Tag(
  '@openwaggle/SessionAuthorizationTargetRepository',
)<SessionAuthorizationTargetRepository, SessionAuthorizationTargetRepositoryShape>() {}
