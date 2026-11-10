import type { SessionHostErrorKind } from '../domain/session-host-refusals'
import type { AgentAuthorizationMode } from './agent-authorization'
import type { SessionCapability } from './session-capability'
import type { ThinkingLevel } from './settings'

export const SESSION_LIFECYCLE_OPERATIONS = ['create', 'fork', 'launch', 'spawn'] as const
export const SESSION_LIFECYCLE_CONTRACT_VERSION = 2 as const

export type LaunchWorkspaceSelection =
  | { readonly mode: 'current' }
  | { readonly mode: 'local' }
  | {
      readonly mode: 'new-worktree'
      readonly baseRef?: string | undefined
      readonly startFromOrigin?: boolean | undefined
    }
  | { readonly mode: 'existing'; readonly workspaceId: string }

export type SpawnWorkspaceSelection =
  | { readonly mode: 'share-parent' }
  | { readonly mode: 'local' }
  | {
      readonly mode: 'new-worktree'
      readonly baseRef?: string | undefined
      readonly startFromOrigin?: boolean | undefined
    }

export type ForkWorkspaceSelection =
  | { readonly mode: 'share-source' }
  | { readonly mode: 'local' }
  | {
      readonly mode: 'new-worktree'
      readonly baseRef?: string | undefined
      readonly startFromOrigin?: boolean | undefined
    }
  | { readonly mode: 'existing'; readonly workspaceId: string }

export interface SessionExecutionSpecialization {
  readonly modelId?: string | undefined
  readonly thinkingLevel?: ThinkingLevel | undefined
  readonly agentDefinitionName?: string | undefined
}

export interface ResolvedSessionExecutionProfile {
  readonly modelId: string
  readonly thinkingLevel: ThinkingLevel
  readonly agentDefinitionName?: string
  readonly tools?: readonly string[]
  readonly skills?: readonly string[]
  readonly mcpServers?: readonly string[]
  readonly sessionCapabilities?: readonly SessionCapability[]
}

export interface DelegationSpecificationInput {
  readonly objective: string
  readonly deliverables: readonly string[]
  readonly acceptanceCriteria: readonly string[]
  readonly dependencies: readonly {
    readonly delegationId: string
    readonly requiredState: 'ready_for_review' | 'accepted'
  }[]
  readonly handoffContext?: string | undefined
  readonly resourceReferences: readonly string[]
}

export interface CreateRootSessionCommand {
  readonly operation: 'create'
  readonly projectPath: string
  readonly title?: string | undefined
  readonly workspace?: LaunchWorkspaceSelection | undefined
  readonly specialization?: SessionExecutionSpecialization | undefined
}

export interface LaunchRootSessionCommand {
  readonly operation: 'launch'
  readonly projectPath: string
  readonly title?: string | undefined
  readonly workspace?: LaunchWorkspaceSelection | undefined
  readonly specialization?: SessionExecutionSpecialization | undefined
  readonly runAuthorizationOverride?: AgentAuthorizationMode | undefined
  readonly objective: string
  readonly attachmentIds: readonly string[]
  readonly interactionTimeoutMs?: number | undefined
}

export interface SpawnWorkerSessionCommand {
  readonly operation: 'spawn'
  readonly parentSessionId: string
  readonly expectedParentRunId: string
  /** A manual title; without one the Worker is titled from its objective. */
  readonly title?: string | undefined
  readonly workspace?: SpawnWorkspaceSelection | undefined
  readonly specialization?: SessionExecutionSpecialization | undefined
  readonly runAuthorizationOverride?: AgentAuthorizationMode | undefined
  readonly interactionTimeoutMs?: number | undefined
  readonly attachmentIds?: readonly string[] | undefined
  readonly delegation: DelegationSpecificationInput
}

export interface ForkSessionCommand {
  readonly operation: 'fork'
  readonly sourceSessionId: string
  readonly targetNodeId?: string | undefined
  readonly position?: 'before' | 'at' | undefined
  readonly title?: string | undefined
  readonly workspace?: ForkWorkspaceSelection | undefined
}

export type SessionLifecycleCommand =
  | CreateRootSessionCommand
  | ForkSessionCommand
  | LaunchRootSessionCommand
  | SpawnWorkerSessionCommand

export interface SessionLifecycleRequest {
  readonly contractVersion: typeof SESSION_LIFECYCLE_CONTRACT_VERSION
  readonly requestId: string
  readonly idempotencyKey: string
  readonly command: SessionLifecycleCommand
}

export type SessionLifecycleOutcome =
  | {
      readonly operation: 'create'
      readonly effect: 'created-root'
      readonly sessionId: string
      readonly workspaceId: string
    }
  | {
      readonly operation: 'fork'
      readonly effect: 'forked-session'
      readonly sessionId: string
      readonly sourceSessionId: string
      readonly sourceNodeId: string
      readonly position: 'before' | 'at'
      readonly workspaceId: string
      readonly editorText?: string | undefined
    }
  | {
      readonly operation: 'launch'
      readonly effect: 'launched-root'
      readonly sessionId: string
      readonly runId: string
      readonly workspaceId: string
    }
  | {
      readonly operation: 'spawn'
      readonly effect: 'spawned-worker'
      readonly sessionId: string
      readonly runId: string
      readonly workspaceId: string
      readonly parentSessionId: string
      readonly parentRunId: string
      readonly hiveRootSessionId: string
      readonly depth: number
      readonly delegationId: string
      readonly derivedGrantId: string
    }
  | {
      readonly operation: SessionLifecycleCommand['operation']
      readonly effect: 'rejected'
      readonly code: string
      /** The kind of refusal, from the Session Host's refusal table (ADR 0063). */
      readonly kind: SessionHostErrorKind
      readonly retryable: boolean
      readonly parentConcurrencyLimit?: number | undefined
      readonly parentRunningChildren?: number | undefined
      /** The Host's ceiling on Runs of agents' work; it never refuses a Run the person starts. */
      readonly hostRunCeiling?: number | undefined
      /** Active Runs of agents' work across the Host when the request was refused. */
      readonly hostActiveRuns?: number | undefined
    }

export interface SessionLifecycleResponse {
  readonly contractVersion: typeof SESSION_LIFECYCLE_CONTRACT_VERSION
  readonly requestId: string
  readonly idempotencyKey: string
  readonly replayed: boolean
  readonly outcome: SessionLifecycleOutcome
}
