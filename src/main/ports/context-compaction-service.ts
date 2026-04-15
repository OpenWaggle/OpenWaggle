/**
 * ContextCompactionService port — domain-owned interface for full LLM compaction.
 *
 * Tier 2 compaction: when microcompaction (Tier 1) isn't enough,
 * this service triggers an LLM-based summarization to compact the conversation.
 */
import type { AgentStreamChunk } from '@shared/types/stream'
import { Context, type Effect } from 'effect'
import type { FullCompactionResult } from '../domain/compaction/compaction-types'
import type { ChatAdapter } from './chat-adapter-type'

/**
 * Structural message shape for the compaction port boundary.
 * Intentionally minimal — avoids importing from agent layer.
 * SimpleChatMessage from message-mapper satisfies this interface.
 */
export interface CompactionMessage {
  readonly role: 'user' | 'assistant' | 'tool'
  readonly content: string | null | readonly unknown[]
  readonly toolCalls?: readonly {
    readonly id: string
    readonly type: 'function'
    readonly function: { readonly name: string; readonly arguments: string }
  }[]
  readonly toolCallId?: string
}

export interface CompactOptions {
  /** The full message array to compact. */
  readonly messages: readonly CompactionMessage[]
  /** Current system prompt (re-injected fresh after compaction). */
  readonly systemPrompt: string
  /** Context window size in tokens for the target model. */
  readonly contextWindowTokens: number
  /** Optional user-provided instructions for what to preserve. */
  readonly customInstructions?: string
  /** Pinned content to exclude from summarization (highest preservation priority). */
  readonly pinnedContent?: readonly string[]
  /** Chat stream function for the compaction LLM call. */
  readonly chatStream: (options: {
    readonly adapter: ChatAdapter
    readonly messages: readonly unknown[]
    readonly systemPrompts?: readonly string[]
    readonly samplingOptions?: Readonly<Record<string, unknown>>
    readonly conversationId?: string
  }) => AsyncIterable<AgentStreamChunk>
  /** Chat adapter for the compaction model. */
  readonly adapter: ChatAdapter
}

export interface ContextCompactionServiceShape {
  /** Check if full compaction is needed based on estimated token usage vs context window. */
  readonly needsFullCompaction: (
    messages: readonly CompactionMessage[],
    contextWindowTokens: number,
  ) => Effect.Effect<boolean>

  /** Run Tier 2 LLM-based compaction. Returns compacted message array + metrics. */
  readonly compact: (
    options: CompactOptions,
  ) => Effect.Effect<{ messages: CompactionMessage[]; result: FullCompactionResult }, Error>
}

export class ContextCompactionService extends Context.Tag('@openwaggle/ContextCompactionService')<
  ContextCompactionService,
  ContextCompactionServiceShape
>() {}
