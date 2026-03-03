import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import {
  type AgentErrorInfo,
  classifyErrorMessage,
  isAgentErrorCode,
  makeErrorInfo,
} from '@shared/types/errors'
import type { SupportedModelId } from '@shared/types/llm'
import type { QualityPreset } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import type { ModelMessage, StreamChunk } from '@tanstack/ai'
import type { ConnectionAdapter, UIMessage } from '@tanstack/ai-react'
import { api } from './ipc'

const DELAY_MS = 50

/**
 * Side-channel for structured error info.
 * TanStack AI's RUN_ERROR handling strips everything except `message`,
 * so we store classified error info here before it gets lost.
 * Cleared on new run start (RUN_STARTED) and on user dismiss.
 */
const lastErrorInfoMap = new Map<string, AgentErrorInfo>()

export function getLastAgentErrorInfo(conversationId: string): AgentErrorInfo | null {
  return lastErrorInfoMap.get(conversationId) ?? null
}

export function clearLastAgentErrorInfo(conversationId: string): void {
  lastErrorInfoMap.delete(conversationId)
}

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
): readonly (ModelMessage | UIMessage)[] {
  return [...messages]
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
 * 2. We fire agent:send-message (or agent:send-waggle-message for Waggle mode)
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
  consumeWaggleConfig?: () => WaggleConfig | null,
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

          // Consume the Waggle config (if any) so sendPromise uses it.
          const waggleConfig = consumeWaggleConfig?.()

          let unsubscribed = false
          const unsub = () => {
            if (unsubscribed) return
            unsubscribed = true
            rawUnsub()
          }
          const rawUnsub = api.onStreamChunk((payload) => {
            if (payload.conversationId !== conversationId) return

            // Clear stale error info when a new run begins.
            if (payload.chunk.type === 'RUN_STARTED') {
              lastErrorInfoMap.delete(conversationId)
            }

            // Intercept RUN_ERROR to capture structured error info before
            // TanStack strips it to just `message`.
            if (payload.chunk.type === 'RUN_ERROR') {
              const error = payload.chunk.error
              const info =
                error.code && isAgentErrorCode(error.code)
                  ? makeErrorInfo(error.code, error.message)
                  : classifyErrorMessage(error.message)
              lastErrorInfoMap.set(conversationId, info)
            }

            queue.push(payload.chunk)

            // Determine if this chunk closes the stream.
            // For Waggle mode, per-turn terminal events are filtered in the
            // handler — only the envelope RUN_STARTED/RUN_FINISHED reach here.
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
          const sendPromise = waggleConfig
            ? api.sendWaggleMessage(conversationId, payload, waggleConfig)
            : api.sendMessage(conversationId, payload, model)

          sendPromise
            .then(() => {
              // Main process run completed. For approval-pending runs,
              // TanStack may skip the terminal RUN_FINISHED(stop) chunk.
              // Mark stream as done so the consumer exits cleanly.
              //
              // Use a short delay to avoid a race condition: in fast-failure
              // cases (e.g. no project path), the handler emits RUN_ERROR +
              // RUN_FINISHED synchronously before returning, but the IPC event
              // channel (webContents.send) and the invoke response channel
              // are processed separately — the invoke can resolve before the
              // stream chunks arrive. The delay gives those chunks time to land.
              setTimeout(() => {
                if (!done) {
                  done = true
                  resolve?.()
                }
              }, DELAY_MS)
            })
            .catch((err) => {
              console.error('[ipc-adapter] sendMessage failed:', err)
              const errMsg = err instanceof Error ? err.message : String(err)
              const info = classifyErrorMessage(errMsg)
              lastErrorInfoMap.set(conversationId, info)
              const errorChunk: StreamChunk = {
                type: 'RUN_ERROR',
                timestamp: Date.now(),
                error: { message: errMsg },
              }
              queue.push(errorChunk)
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
