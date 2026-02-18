import type { Message } from './agent'
import type { ConversationId } from './brand'
import type { SupportedModelId } from './llm'

export interface Conversation {
  readonly id: ConversationId
  readonly title: string
  readonly model: SupportedModelId
  readonly projectPath: string | null
  readonly messages: Message[]
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ConversationSummary {
  readonly id: ConversationId
  readonly title: string
  readonly model: SupportedModelId
  readonly projectPath: string | null
  readonly messageCount: number
  readonly createdAt: number
  readonly updatedAt: number
}
