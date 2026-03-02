import type { SubAgentId, TaskId, TeamId } from './brand'

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

export interface TaskRecord {
  readonly id: TaskId
  readonly subject: string
  readonly description: string
  readonly activeForm?: string
  readonly status: TaskStatus
  readonly owner?: string
  readonly blocks: readonly TaskId[]
  readonly blockedBy: readonly TaskId[]
  readonly metadata: Readonly<Record<string, unknown>>
  readonly createdAt: number
  readonly updatedAt: number
}

export type TeamMemberStatus = 'active' | 'idle' | 'shutdown'

export interface TeamMember {
  readonly name: string
  readonly agentId: SubAgentId
  readonly agentType: string
  readonly status: TeamMemberStatus
}

export interface TeamRecord {
  readonly id: TeamId
  readonly name: string
  readonly description?: string
  readonly members: readonly TeamMember[]
  readonly createdAt: number
}

export type AgentMessageType =
  | 'message'
  | 'broadcast'
  | 'shutdown_request'
  | 'shutdown_response'
  | 'plan_approval_request'
  | 'plan_approval_response'

export interface AgentMessage {
  readonly type: AgentMessageType
  readonly sender: string
  readonly recipient?: string
  readonly content: string
  readonly summary?: string
  readonly requestId?: string
  readonly approve?: boolean
  readonly timestamp: number
}
