/**
 * TanStack AI chat adapter — implements ChatService port.
 *
 * This is the ONLY module that calls `chat()` from `@tanstack/ai`.
 * All other code uses the domain-owned `AgentStreamChunk` type.
 */
import { HTTP_TIMEOUT } from '@shared/constants/timeouts'
import type { AgentStreamChunk } from '@shared/types/stream'
import { type AnyTextAdapter, chat, maxIterations, type StreamChunk } from '@tanstack/ai'
import { Effect, Layer } from 'effect'
import { ChatStreamError } from '../errors'
import { type ChatAdapter, unwrapChatAdapter } from '../ports/chat-adapter-type'
import {
  ChatService,
  type ChatStreamOptions,
  type TestConnectionOptions,
} from '../ports/chat-service'
import { toAgentStreamChunk } from './stream-chunk-mapper'

/**
 * Type guard validating that the unwrapped inner value is a vendor AnyTextAdapter.
 * Checks the `kind: 'text'` discriminator that all TanStack AI text adapters carry.
 */
function isVendorTextAdapter(value: unknown): value is AnyTextAdapter {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false
  }
  // After `in` narrowing, TS knows `value` has a `kind` property
  return value.kind === 'text'
}

/**
 * Unwrap the branded ChatAdapter to the vendor AnyTextAdapter.
 * This is the ONLY place where the opaque adapter is resolved to the vendor type.
 */
function unwrapToVendorAdapter(adapter: ChatAdapter): AnyTextAdapter {
  const inner = unwrapChatAdapter(adapter)
  if (!isVendorTextAdapter(inner)) {
    throw new Error('ChatAdapter does not contain a valid vendor text adapter')
  }
  return inner
}

/**
 * Create an async iterable that maps vendor StreamChunks to domain AgentStreamChunks.
 */
async function* mapStreamToDomain(
  vendorStream: AsyncIterable<StreamChunk>,
): AsyncIterable<AgentStreamChunk> {
  for await (const chunk of vendorStream) {
    yield toAgentStreamChunk(chunk)
  }
}

/// <reference path="./tanstack-chat-overload.d.ts" />

/**
 * Start a chat stream with the given options, returning domain-owned chunks.
 *
 * Uses the permissive overload declared in tanstack-chat-overload.d.ts to accept
 * unknown[] arrays from the domain boundary.
 */
export function startChatStream(options: ChatStreamOptions): AsyncIterable<AgentStreamChunk> {
  const vendorAdapter = unwrapToVendorAdapter(options.adapter)
  const vendorStream = chat({
    adapter: vendorAdapter,
    messages: [...options.messages],
    ...(options.systemPrompts ? { systemPrompts: [...options.systemPrompts] } : {}),
    ...(options.tools ? { tools: [...options.tools] } : {}),
    ...(options.maxIterations ? { agentLoopStrategy: maxIterations(options.maxIterations) } : {}),
    ...(options.abortController ? { abortController: options.abortController } : {}),
    ...(options.conversationId ? { conversationId: options.conversationId } : {}),
    ...options.samplingOptions,
  })
  return mapStreamToDomain(vendorStream)
}

/**
 * Test a provider connection by sending a minimal chat request.
 */
async function testProviderConnection(options: TestConnectionOptions): Promise<void> {
  const vendorAdapter = unwrapToVendorAdapter(options.adapter)
  const abortController = options.abortController ?? new AbortController()
  const timeout = setTimeout(() => abortController.abort(), HTTP_TIMEOUT.TEST_CONNECTION_MS)

  try {
    const stream = chat({
      adapter: vendorAdapter,
      messages: [{ role: 'user', content: 'Hi' }],
      abortController,
    })

    for await (const chunk of stream) {
      if (chunk.type === 'RUN_ERROR') {
        throw new Error(chunk.error.message)
      }
      if (chunk.type === 'RUN_FINISHED') {
        return
      }
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Effect Layer providing ChatService backed by TanStack AI.
 */
export const TanStackChatLive = Layer.succeed(
  ChatService,
  ChatService.of({
    stream: (options) =>
      Effect.try({
        try: () => startChatStream(options),
        catch: (cause) =>
          new ChatStreamError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),
    testConnection: (options) =>
      Effect.tryPromise({
        try: () => testProviderConnection(options),
        catch: (cause) =>
          new ChatStreamError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),
  }),
)
