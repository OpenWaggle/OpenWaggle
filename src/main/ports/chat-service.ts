/**
 * ChatService port — domain-owned interface for LLM streaming.
 *
 * Replaces direct `chat()` calls from `@tanstack/ai` in the agent loop.
 * Implemented by the TanStack AI adapter layer.
 */
import type { AgentStreamChunk } from '@shared/types/stream'
import { Context, type Effect } from 'effect'
import type { ChatStreamError } from '../errors'
import type { ChatAdapter } from './chat-adapter-type'

export interface ChatStreamOptions {
  readonly adapter: ChatAdapter
  readonly messages: readonly unknown[]
  readonly systemPrompts?: readonly string[]
  /** Tools are passed as opaque objects; the adapter layer resolves them to vendor types. */
  readonly tools?: readonly unknown[]
  readonly maxIterations?: number
  readonly abortController?: AbortController
  readonly samplingOptions?: Readonly<Record<string, unknown>>
  readonly conversationId?: string
}

export interface TestConnectionOptions {
  readonly adapter: ChatAdapter
  readonly abortController?: AbortController
}

export interface ChatServiceShape {
  readonly stream: (
    options: ChatStreamOptions,
  ) => Effect.Effect<AsyncIterable<AgentStreamChunk>, ChatStreamError>
  readonly testConnection: (options: TestConnectionOptions) => Effect.Effect<void, ChatStreamError>
}

export class ChatService extends Context.Tag('@openwaggle/ChatService')<
  ChatService,
  ChatServiceShape
>() {}
