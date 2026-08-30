import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'
import type {
  SessionLifecycleRequest,
  SessionLifecycleResponse,
} from '@shared/types/session-lifecycle'
import { Context, type Effect } from 'effect'
import type { SessionLifecycleRepositoryError } from '../errors'
import type { AgentKernelSessionSnapshot } from './agent-kernel-service'

export interface ProvisionedSessionIdentity {
  readonly sessionId: string
  readonly piSessionId: string
  readonly piSessionFile?: string
}

export type SessionLifecycleWorkspacePlan =
  | { readonly mode: 'parent' }
  | { readonly mode: 'existing'; readonly workspaceId: string }
  | {
      readonly mode: 'provisioned'
      readonly workspace: {
        readonly id: string
        readonly projectPath: string
        readonly kind: 'local' | 'managed-worktree'
        readonly workingPath: string
        readonly lifecycleState: 'pending' | 'ready'
        readonly worktreeBranch?: string
        readonly worktreeBaseRef?: string
        readonly worktreeStartFromOrigin?: boolean
      }
    }

export interface SessionLifecycleExecutionSnapshot {
  readonly profile: unknown
  readonly resolvedAgentSnapshot?: unknown
  readonly authorizationCeiling: AgentAuthorizationMode
}

export interface ExecuteSessionLifecycleInput {
  readonly callerId: string
  readonly callerAuthorityScope?: LocalSessionProfileScope
  readonly request: SessionLifecycleRequest
  readonly session: ProvisionedSessionIdentity
  readonly runId?: string
  readonly delegationId?: string
  readonly derivedGrantId?: string
  readonly workspacePlan: SessionLifecycleWorkspacePlan
  readonly executionSnapshot: SessionLifecycleExecutionSnapshot
  readonly derivedCapabilities?: readonly string[]
  readonly parentConcurrencyLimit?: number
  readonly hostRunCeiling?: number
  readonly forkSnapshot?: AgentKernelSessionSnapshot
  readonly forkEditorText?: string
  readonly forkSourceNodeId?: string
  readonly now: number
}

export interface SessionLifecycleRepositoryShape {
  readonly findReplay?: (input: {
    readonly callerId: string
    readonly request: SessionLifecycleRequest
  }) => Effect.Effect<SessionLifecycleResponse | undefined, SessionLifecycleRepositoryError>
  readonly execute: (
    input: ExecuteSessionLifecycleInput,
  ) => Effect.Effect<SessionLifecycleResponse, SessionLifecycleRepositoryError>
}

export class SessionLifecycleRepository extends Context.Tag(
  '@openwaggle/SessionLifecycleRepository',
)<SessionLifecycleRepository, SessionLifecycleRepositoryShape>() {}
