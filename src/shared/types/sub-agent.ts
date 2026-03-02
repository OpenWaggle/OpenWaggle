import type { SubAgentId, TeamId } from './brand'
import type { SupportedModelId } from './llm'

export type AgentPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'dontAsk'
  | 'bypassPermissions'
  | 'plan'

export type AgentToolFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'allow'; readonly names: readonly string[] }
  | { readonly kind: 'deny'; readonly names: readonly string[] }

export interface AgentTypeDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly toolFilter: AgentToolFilter
  readonly systemPromptAddition: string
  readonly isBuiltIn: boolean
  readonly sourcePath?: string
}

export interface SpawnAgentInput {
  readonly description: string
  readonly prompt: string
  readonly agentType?: string
  readonly name?: string
  readonly model?: SupportedModelId
  readonly mode?: AgentPermissionMode
  readonly isolation?: 'worktree'
  readonly runInBackground?: boolean
  readonly teamName?: string
  readonly resume?: SubAgentId
  readonly maxTurns?: number
}

export interface SubAgentResult {
  readonly agentId: SubAgentId
  readonly status: 'completed' | 'failed' | 'cancelled'
  readonly output: string
  readonly turnCount: number
  readonly toolCallCount: number
  readonly worktreeInfo?: {
    readonly path: string
    readonly branch: string
    readonly hasChanges: boolean
  }
}

export interface SubAgentContext {
  readonly agentId: SubAgentId
  readonly agentName: string
  readonly teamId?: string
  readonly permissionMode: AgentPermissionMode
  readonly depth: number
}

// ─── IPC Event Payloads ──────────────────────────────────────

interface SubAgentEventBase {
  readonly agentId: SubAgentId
  readonly agentName: string
  readonly teamId?: string
  readonly timestamp: number
}

export type SubAgentEventPayload =
  | (SubAgentEventBase & {
      readonly eventType: 'started'
      readonly data: { readonly agentType: string; readonly depth: number }
    })
  | (SubAgentEventBase & {
      readonly eventType: 'completed'
      readonly data: { readonly turnCount: number; readonly toolCallCount: number }
    })
  | (SubAgentEventBase & {
      readonly eventType: 'failed'
      readonly data: { readonly reason: 'cancelled' | 'error' }
    })
  | (SubAgentEventBase & {
      readonly eventType: 'idle'
    })
  | (SubAgentEventBase & {
      readonly eventType: 'message_received'
    })

interface TeamEventBase {
  readonly teamId: TeamId
  readonly timestamp: number
}

export type TeamEventPayload =
  | (TeamEventBase & {
      readonly eventType: 'team_created'
      readonly data?: { readonly description?: string }
    })
  | (TeamEventBase & {
      readonly eventType: 'team_deleted'
    })
  | (TeamEventBase & {
      readonly eventType: 'member_joined'
      readonly data: { readonly memberName: string; readonly agentType: string }
    })
  | (TeamEventBase & {
      readonly eventType: 'member_shutdown'
      readonly data: { readonly agentId: SubAgentId }
    })
  | (TeamEventBase & {
      readonly eventType: 'task_updated'
      readonly data: { readonly taskId: string; readonly subject?: string; readonly status: string }
    })
