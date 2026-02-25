import type { Message } from './agent'
import type { ConversationId } from './brand'
import type { MultiAgentConfig } from './multi-agent'

export interface Conversation {
  readonly id: ConversationId
  readonly title: string
  readonly projectPath: string | null
  readonly messages: Message[]
  readonly multiAgentConfig?: MultiAgentConfig
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ConversationSummary {
  readonly id: ConversationId
  readonly title: string
  readonly projectPath: string | null
  readonly messageCount: number
  readonly createdAt: number
  readonly updatedAt: number
}
