import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { ModelMessage, StreamChunk } from '@tanstack/ai'
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
): ConnectionAdapter {
  return {
    connect(_messages, _data, abortSignal) {
      // We ignore the `messages` param from useChat — the main process
      // loads conversation history from disk via conversationId.
      // This keeps the main process as the single source of truth for persistence.
      return {
        async *[Symbol.asyncIterator]() {
          // Queue + signal pattern for bridging push-based IPC → pull-based AsyncIterable
          const queue: StreamChunk[] = []
          let resolve: (() => void) | null = null
          let done = false

          function isTerminalChunk(chunk: StreamChunk): boolean {
            if (chunk.type === 'RUN_ERROR') return true
            if (chunk.type === 'RUN_FINISHED') {
              // TanStack emits intermediate RUN_FINISHED (finishReason: 'tool_calls')
              // before server tool execution completes.
              return chunk.finishReason !== 'tool_calls'
            }
            return false
          }

          const unsub = api.onStreamChunk((payload) => {
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
              api.cancelAgent(conversationId)
              done = true
              resolve?.()
            },
            { once: true },
          )

          // Start the agent run in the main process.
          // We extract the user message from the last message in the array that
          // useChat passes us — it always appends the new user message before calling connect().
          const content = extractLastUserContent(_messages)

          // Fire and forget — main process streams chunks back via IPC.
          // Catch to avoid unhandled rejection (errors are delivered via stream chunks).
          api.sendMessage(conversationId, content, model).catch((err) => {
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
