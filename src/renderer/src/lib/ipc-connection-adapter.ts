import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { QualityPreset } from '@shared/types/settings'
import { convertMessagesToModelMessages, type ModelMessage, type StreamChunk } from '@tanstack/ai'
import type { ConnectionAdapter, UIMessage } from '@tanstack/ai-react'
import { api } from './ipc'

/**
 * Extract the text content from the last user message in the array.
 * useChat always appends the new user message before calling connect().
 */
function extractLastUserContent(messages: Array<UIMessage> | Array<ModelMessage>): string {
  const lastMsg = messages[messages.length - 1]
  if (!lastMsg) return ''

  // UIMessage — has `parts` array
  if ('parts' in lastMsg) {
    return lastMsg.parts
      .filter((p): p is { type: 'text'; content: string } => p.type === 'text')
      .map((p) => p.content)
      .join('')
  }

  // ModelMessage — content is string | ContentPart[]
  if ('content' in lastMsg) {
    const content = lastMsg.content
    if (typeof content === 'string') return content
    if (content === null) return ''
    // ContentPart[] — extract text parts
    return content
      .filter((p): p is { type: 'text'; content: string } => p.type === 'text')
      .map((p) => p.content)
      .join('')
  }

  return ''
}

function shouldUseContinuationPayload(messages: Array<UIMessage> | Array<ModelMessage>): boolean {
  const lastMsg = messages[messages.length - 1]
  if (!lastMsg) return false
  return lastMsg.role !== 'user'
}

function toContinuationMessages(
  messages: Array<UIMessage> | Array<ModelMessage>,
): readonly ModelMessage[] {
  const converted = convertMessagesToModelMessages(messages)
  return normalizeContinuationMessages(converted)
}

function hasModelMessageContent(message: ModelMessage): boolean {
  if (message.content === null) return false
  if (typeof message.content === 'string') return message.content.length > 0
  return message.content.length > 0
}

function normalizeContinuationMessages(messages: readonly ModelMessage[]): readonly ModelMessage[] {
  const normalized: ModelMessage[] = []
  const seenToolCallIds = new Set<string>()
  const seenToolResultIds = new Set<string>()

  for (const message of messages) {
    if (message.role === 'tool' && message.toolCallId) {
      if (seenToolResultIds.has(message.toolCallId)) {
        continue
      }
      seenToolResultIds.add(message.toolCallId)
      normalized.push(message)
      continue
    }

    if (message.role !== 'assistant' || !message.toolCalls || message.toolCalls.length === 0) {
      normalized.push(message)
      continue
    }

    // Anthropic rejects payloads with duplicate tool_use IDs in continuation history.
    const dedupedToolCalls = message.toolCalls.filter((toolCall) => {
      if (seenToolCallIds.has(toolCall.id)) {
        return false
      }
      seenToolCallIds.add(toolCall.id)
      return true
    })

    if (dedupedToolCalls.length === 0 && !hasModelMessageContent(message)) {
      continue
    }

    if (dedupedToolCalls.length === message.toolCalls.length) {
      normalized.push(message)
      continue
    }

    if (dedupedToolCalls.length > 0) {
      normalized.push({ ...message, toolCalls: dedupedToolCalls })
      continue
    }

    const { toolCalls: _toolCalls, ...messageWithoutToolCalls } = message
    normalized.push(messageWithoutToolCalls)
  }

  return normalized
}

/**
 * Detect whether a stream chunk signals the end of an agent run.
 * TanStack emits intermediate RUN_FINISHED (finishReason: 'tool_calls')
 * before server tool execution completes — only treat non-tool-call finishes
 * and errors as terminal.
 */
export function isTerminalChunk(chunk: StreamChunk): boolean {
  if (chunk.type === 'RUN_ERROR') return true
  if (chunk.type === 'RUN_FINISHED') {
    return chunk.finishReason !== 'tool_calls'
  }
  return false
}

/**
 * Custom ConnectionAdapter that bridges TanStack AI's useChat with Electron IPC.
 *
 * Flow:
 * 1. useChat calls connect() when sendMessage() is invoked
 * 2. We fire agent:send-message to the main process (which runs the agent loop)
 * 3. Main process forwards raw StreamChunks via agent:stream-chunk IPC channel
 * 4. We yield them as an AsyncIterable<StreamChunk> back to useChat
 * 5. useChat processes chunks into UIMessages (text, tool calls, etc.)
 *
 * The main process still handles persistence — it collects message parts during
 * streaming and saves the conversation after the run completes.
 */
export function createIpcConnectionAdapter(
  conversationId: ConversationId,
  model: SupportedModelId,
  consumePendingPayload: () => AgentSendPayload | null,
  defaultQualityPreset: QualityPreset,
): ConnectionAdapter {
  return {
    connect(_messages, _data, abortSignal) {
      // For first user sends, main process loads conversation history from disk.
      // For continuation sends (e.g. tool approval), we forward in-memory
      // messages so approval state is preserved across the next run.
      return {
        async *[Symbol.asyncIterator]() {
          // Queue + signal pattern for bridging push-based IPC → pull-based AsyncIterable
          const queue: StreamChunk[] = []
          let resolve: (() => void) | null = null
          let done = false

          let unsubscribed = false
          const unsub = () => {
            if (unsubscribed) return
            unsubscribed = true
            rawUnsub()
          }
          const rawUnsub = api.onStreamChunk((payload) => {
            if (payload.conversationId !== conversationId) return

            queue.push(payload.chunk)
            if (isTerminalChunk(payload.chunk)) {
              done = true
            }
            // Wake up the consumer if it's waiting
            resolve?.()
          })

          // Handle abort
          abortSignal?.addEventListener(
            'abort',
            () => {
              // Do not cancel main-process execution on chat client teardown.
              // This allows runs to continue in the background when switching threads.
              // Unsubscribe from IPC events to prevent unbounded queue growth —
              // the run still completes and persists in main process, so the user
              // can reload the conversation later to see the full result.
              unsub()
              done = true
              resolve?.()
            },
            { once: true },
          )

          // Start the agent run in the main process.
          // We extract the user message from the last message in the array for
          // first sends. For continuation sends we attach the full message snapshot.
          const fallbackPayload: AgentSendPayload = {
            text: extractLastUserContent(_messages),
            qualityPreset: defaultQualityPreset,
            attachments: [],
          }
          const pendingPayload = consumePendingPayload()
          const payload =
            pendingPayload ??
            (shouldUseContinuationPayload(_messages)
              ? {
                  text: '',
                  qualityPreset: defaultQualityPreset,
                  attachments: [],
                  continuationMessages: toContinuationMessages(_messages),
                }
              : fallbackPayload)

          // Fire and forget — main process streams chunks back via IPC.
          // Catch to avoid unhandled rejection (errors are delivered via stream chunks).
          api.sendMessage(conversationId, payload, model).catch((err) => {
            console.error('[ipc-adapter] sendMessage failed:', err)
            queue.push({
              type: 'RUN_ERROR',
              timestamp: Date.now(),
              error: { message: err instanceof Error ? err.message : String(err) },
            } as StreamChunk)
            done = true
            resolve?.()
          })

          try {
            while (!done || queue.length > 0) {
              const next = queue.shift()
              if (next) {
                yield next
              } else {
                // Wait for the next chunk
                await new Promise<void>((r) => {
                  resolve = r
                })
              }
            }
          } finally {
            unsub()
          }
        },
      }
    },
  }
}
