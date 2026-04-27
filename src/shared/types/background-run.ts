import type { MessagePart } from './agent'
import type { ConversationId } from './brand'
import type { SupportedModelId } from './llm'

/** The run mode for a live Pi-backed execution. */
export type RunMode = 'classic' | 'waggle'

/** Lightweight info about an active background run (no message content). */
export interface ActiveRunInfo {
  readonly conversationId: ConversationId
  readonly model: SupportedModelId
  readonly mode: RunMode
  readonly startedAt: number
}

/** Full snapshot including accumulated message parts for reconnection. */
export interface BackgroundRunSnapshot extends ActiveRunInfo {
  readonly parts: readonly MessagePart[]
}
