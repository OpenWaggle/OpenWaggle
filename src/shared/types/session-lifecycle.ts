import type { AgentAuthorizationMode } from './agent-authorization'
import type { ResolvedAgentDefinitionSnapshot } from './agent-definition'
import type { SessionCapability } from './session-capability'
import type { ThinkingLevel } from './settings'

export const SESSION_LIFECYCLE_OPERATIONS = ['create', 'fork', 'launch', 'spawn'] as const
export const SESSION_LIFECYCLE_CONTRACT_VERSION = 2 as const

export type LaunchWorkspaceSelection =
  | { readonly mode: 'current' }
  | { readonly mode: 'local' }
  | {
      readonly mode: 'new-worktree'
      readonly baseRef?: string
      readonly startFromOrigin?: boolean
    }
  | { readonly mode: 'existing'; readonly workspaceId: string }

export type SpawnWorkspaceSelection =
  | { readonly mode: 'share-parent' }
  | { readonly mode: 'local' }
  | {
      readonly mode: 'new-worktree'
      readonly baseRef?: string
      readonly startFromOrigin?: boolean
    }

export type ForkWorkspaceSelection =
  | { readonly mode: 'share-source' }
  | { readonly mode: 'local' }
  | {
      readonly mode: 'new-worktree'
      readonly baseRef?: string
      readonly startFromOrigin?: boolean
    }
  | { readonly mode: 'existing'; readonly workspaceId: string }

export interface SessionExecutionSpecialization {
  readonly modelId?: string
  readonly thinkingLevel?: ThinkingLevel
  readonly agentDefinitionName?: string
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

export interface SessionExecutionProfileSnapshot {
  readonly profile: ResolvedSessionExecutionProfile
  readonly resolvedAgentSnapshot?: ResolvedAgentDefinitionSnapshot
  readonly authorizationCeiling: AgentAuthorizationMode
}

export interface DelegationSpecificationInput {
  readonly objective: string
  readonly deliverables: readonly string[]
  readonly acceptanceCriteria: readonly string[]
  readonly dependencies: readonly {
    readonly delegationId: string
    readonly requiredState: 'ready_for_review' | 'accepted'
  }[]
  readonly handoffContext?: string
  readonly resourceReferences: readonly string[]
}

export interface CreateRootSessionCommand {
  readonly operation: 'create'
  readonly projectPath: string
  readonly title?: string
  readonly workspace?: LaunchWorkspaceSelection
  readonly specialization?: SessionExecutionSpecialization
}

export interface LaunchRootSessionCommand {
  readonly operation: 'launch'
  readonly projectPath: string
  readonly title?: string
  readonly workspace?: LaunchWorkspaceSelection
  readonly specialization?: SessionExecutionSpecialization
  readonly runAuthorizationOverride?: AgentAuthorizationMode
  readonly objective: string
  readonly attachmentIds: readonly string[]
  readonly interactionTimeoutMs?: number
}

export interface SpawnWorkerSessionCommand {
  readonly operation: 'spawn'
  readonly parentSessionId: string
  readonly expectedParentRunId: string
  readonly workspace?: SpawnWorkspaceSelection
  readonly specialization?: SessionExecutionSpecialization
  readonly runAuthorizationOverride?: AgentAuthorizationMode
  readonly interactionTimeoutMs?: number
  readonly attachmentIds?: readonly string[]
  readonly delegation: DelegationSpecificationInput
}

export interface ForkSessionCommand {
  readonly operation: 'fork'
  readonly sourceSessionId: string
  readonly targetNodeId?: string
  readonly position?: 'before' | 'at'
  readonly title?: string
  readonly workspace?: ForkWorkspaceSelection
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
      readonly editorText?: string
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
      readonly retryable: boolean
      readonly parentConcurrencyLimit?: number
      readonly parentRunningChildren?: number
      readonly hostRunCeiling?: number
      readonly hostActiveRuns?: number
    }

export interface SessionLifecycleResponse {
  readonly contractVersion: typeof SESSION_LIFECYCLE_CONTRACT_VERSION
  readonly requestId: string
  readonly idempotencyKey: string
  readonly replayed: boolean
  readonly outcome: SessionLifecycleOutcome
}
