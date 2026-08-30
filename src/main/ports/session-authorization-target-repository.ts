import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
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
  readonly resolveWorkspaceProjectPaths?: (
    workspaceRoots: readonly string[],
  ) => Effect.Effect<readonly string[], SessionAuthorizationTargetRepositoryError>
  readonly resolve: (
    sessionId: string,
  ) => Effect.Effect<SessionAuthorizationTarget, SessionAuthorizationTargetRepositoryError>
  readonly resolveDelegation: (
    delegationId: string,
  ) => Effect.Effect<SessionAuthorizationTarget, SessionAuthorizationTargetRepositoryError>
  readonly listLiveDerivedAuthorities: (callerId: string) => Effect.Effect<
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
