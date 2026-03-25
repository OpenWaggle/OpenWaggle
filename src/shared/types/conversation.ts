import type { Message } from './agent'
import type { ConversationId } from './brand'
import type { WaggleConfig } from './waggle'

export interface Conversation {
  readonly id: ConversationId
  readonly title: string
  readonly projectPath: string | null
  readonly messages: Message[]
  readonly waggleConfig?: WaggleConfig
  readonly archived?: boolean
  readonly planModeActive?: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ConversationSummary {
  readonly id: ConversationId
  readonly title: string
  readonly projectPath: string | null
  readonly messageCount: number
  readonly archived?: boolean
  readonly planModeActive?: boolean
  readonly createdAt: number
  readonly updatedAt: number
}
