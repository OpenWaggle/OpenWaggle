import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type {
  DelegationId,
  DerivedGrantId,
  RunId,
  SessionId,
  WorkspaceId,
} from '@shared/types/brand'
import type { SessionCapability } from '@shared/types/session-capability'
import type { SessionLifecycleRequest } from '@shared/types/session-lifecycle'
import { Context, type Effect } from 'effect'
import type { SessionLifecyclePreparationError } from '../errors'
import type { AgentKernelSessionSnapshot } from './agent-kernel-service'
import type {
  ProvisionedSessionIdentity,
  SessionLifecycleExecutionSnapshot,
  SessionLifecycleWorkspacePlan,
} from './session-lifecycle-repository'

export interface SessionLifecycleAllocatedIdentities {
  readonly sessionId: SessionId
  readonly workspaceId: WorkspaceId
  readonly runId?: RunId
  readonly delegationId?: DelegationId
  readonly derivedGrantId?: DerivedGrantId
}

export interface PrepareSessionLifecycleInput {
  readonly callerId: string
  readonly callerCapabilities?: readonly SessionCapability[]
  readonly callerAuthorizationCeiling?: AgentAuthorizationMode
  readonly initiatingWorkingDirectory?: string
  readonly request: SessionLifecycleRequest
  readonly identities: SessionLifecycleAllocatedIdentities
}

export interface PreparedSessionLifecycleAttempt {
  readonly attemptId: string
  readonly session: ProvisionedSessionIdentity
  readonly workspacePlan: SessionLifecycleWorkspacePlan
  readonly executionSnapshot: SessionLifecycleExecutionSnapshot
  readonly derivedCapabilities?: readonly string[]
  readonly parentConcurrencyLimit?: number
  readonly hostRunCeiling?: number
  readonly forkSnapshot?: AgentKernelSessionSnapshot
  readonly forkEditorText?: string
  readonly forkSourceNodeId?: string
}

export type SessionLifecycleDiscardReason = 'rejected' | 'replayed' | 'repository-failure'

export interface SessionLifecyclePreparationServiceShape {
  /**
   * Resolves policy and prepares external Pi and Workspace resources. A failed preparation cleans
   * its own partial resources before returning an error.
   */
  readonly prepare: (
    input: PrepareSessionLifecycleInput,
  ) => Effect.Effect<PreparedSessionLifecycleAttempt, SessionLifecyclePreparationError>
  /**
   * Idempotently releases only resources created by this attempt. Reused durable resources are
   * never removed. Residual cleanup failures are recorded by the adapter rather than hidden.
   */
  readonly discard: (input: {
    readonly attempt: PreparedSessionLifecycleAttempt
    readonly reason: SessionLifecycleDiscardReason
  }) => Effect.Effect<void, SessionLifecyclePreparationError>
  readonly commit: (input: {
    readonly attempt: PreparedSessionLifecycleAttempt
  }) => Effect.Effect<void, SessionLifecyclePreparationError>
  readonly recoverPending: Effect.Effect<void, SessionLifecyclePreparationError>
}

export class SessionLifecyclePreparationService extends Context.Tag(
  '@openwaggle/SessionLifecyclePreparationService',
)<SessionLifecyclePreparationService, SessionLifecyclePreparationServiceShape>() {}
