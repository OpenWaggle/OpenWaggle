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
import { hasConcreteToolOutput, isDeniedApprovalPayload } from '@shared/utils/tool-result-state'
import type { ModelMessage, StreamChunk } from '@tanstack/ai'
import type { ConnectionAdapter, UIMessage } from '@tanstack/ai-react'
import { env } from '@/env'
import { api } from './ipc'
import { createRendererLogger } from './logger'

const ipcLogger = createRendererLogger('ipc-adapter')

const SEND_RESOLVE_FALLBACK_MS = 2000
const RUN_COMPLETED_CLOSE_GRACE_MS = 300
const RUN_COMPLETED_PENDING_TOOL_GRACE_MS = 2000

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
  if (lastMsg.role === 'user') return false
  return hasApprovalContinuationSnapshot(messages)
}

function hasApprovalContinuationSnapshot(
  messages: Array<UIMessage> | Array<ModelMessage>,
): boolean {
  const completedToolCallIds = new Set<string>()

  for (const message of messages) {
    if (!('parts' in message)) {
      continue
    }
    for (const part of message.parts) {
      if (part.type === 'tool-result') {
        const payload = 'output' in part ? part.output : part.content
        if (hasConcreteToolOutput(payload)) {
          completedToolCallIds.add(part.toolCallId)
        }
      }
    }
  }

  for (const message of messages) {
    if (!('parts' in message)) {
      continue
    }
    for (const part of message.parts) {
      if (part.type !== 'tool-call') {
        continue
      }
      if (completedToolCallIds.has(part.id)) {
        continue
      }
      if (isDeniedApprovalPayload(part.output)) {
        continue
      }
      const approvalResolved =
        part.state === 'approval-responded' || typeof part.approval?.approved === 'boolean'
      if (approvalResolved && !hasConcreteToolOutput(part.output)) {
        return true
      }
    }
  }

  return false
}

function toContinuationMessages(
  messages: Array<UIMessage> | Array<ModelMessage>,
): readonly (ModelMessage | UIMessage)[] {
  return [...messages]
}

function describeContinuationMessageFormat(
  messages: Array<UIMessage> | Array<ModelMessage>,
): 'ui' | 'model' | 'mixed' | 'none' {
  if (messages.length === 0) {
    return 'none'
  }

  let sawUiMessage = false
  let sawModelMessage = false

  for (const message of messages) {
    if ('parts' in message) {
      sawUiMessage = true
    } else {
      sawModelMessage = true
    }
  }

  if (sawUiMessage && sawModelMessage) {
    return 'mixed'
  }

  return sawUiMessage ? 'ui' : 'model'
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
          const pendingToolResultIds = new Set<string>()
          let resolve: (() => void) | null = null
          let done = false
          let runCompletedEventSeen = false
          let runStartedSeen = false
          let approvalTraceActive = false
          const approvalTraceEnabled = env.approvalTraceEnabled
          let fallbackCloseTimer: ReturnType<typeof setTimeout> | null = null
          let runCompletedCloseTimer: ReturnType<typeof setTimeout> | null = null

          // Consume the Waggle config (if any) so sendPromise uses it.
          const waggleConfig = consumeWaggleConfig?.()

          let unsubscribed = false
          const clearFallbackCloseTimer = (): void => {
            if (fallbackCloseTimer !== null) {
              clearTimeout(fallbackCloseTimer)
              fallbackCloseTimer = null
            }
          }
          const clearRunCompletedCloseTimer = (): void => {
            if (runCompletedCloseTimer !== null) {
              clearTimeout(runCompletedCloseTimer)
              runCompletedCloseTimer = null
            }
          }
          const traceApproval = (event: string, data?: object): void => {
            if (!approvalTraceEnabled || !approvalTraceActive) {
              return
            }
            ipcLogger.info(`[approval-trace] ${event}`, {
              conversationId,
              pendingToolResults: pendingToolResultIds.size,
              runCompletedEventSeen,
              ...data,
            })
          }
          const closeStream = (reason: string): void => {
            if (done) {
              return
            }
            done = true
            clearFallbackCloseTimer()
            clearRunCompletedCloseTimer()
            traceApproval('close', { reason })
            resolve?.()
          }
          const scheduleFallbackClose = (): void => {
            if (fallbackCloseTimer !== null || done || runCompletedEventSeen) {
              return
            }
            fallbackCloseTimer = setTimeout(() => {
              fallbackCloseTimer = null
              if (!done && !runCompletedEventSeen) {
                closeStream('send-resolved-fallback')
              }
            }, SEND_RESOLVE_FALLBACK_MS)
          }
          const scheduleRunCompletedClose = (): void => {
            clearRunCompletedCloseTimer()
            if (done) {
              return
            }
            const closeDelayMs =
              pendingToolResultIds.size > 0
                ? RUN_COMPLETED_PENDING_TOOL_GRACE_MS
                : RUN_COMPLETED_CLOSE_GRACE_MS
            runCompletedCloseTimer = setTimeout(() => {
              runCompletedCloseTimer = null
              if (!done) {
                closeStream('run-completed-grace')
              }
            }, closeDelayMs)
          }
          const unsub = () => {
            if (unsubscribed) return
            unsubscribed = true
            rawUnsub()
            runCompletedUnsub()
          }
          const rawUnsub = api.onStreamChunk((payload) => {
            if (payload.conversationId !== conversationId) return

            if (
              approvalTraceEnabled &&
              payload.chunk.type === 'CUSTOM' &&
              payload.chunk.name === 'approval-requested'
            ) {
              approvalTraceActive = true
            }
            if (payload.chunk.type === 'TOOL_CALL_END') {
              approvalTraceActive =
                approvalTraceEnabled && (approvalTraceActive || payload.chunk.result === undefined)
              if (payload.chunk.result === undefined) {
                pendingToolResultIds.add(payload.chunk.toolCallId)
              } else {
                pendingToolResultIds.delete(payload.chunk.toolCallId)
              }
            }

            // Clear stale state when a new run begins. This is critical for
            // the steer flow: the old run's `run-completed` event may arrive at
            // this adapter before the new run's first chunk, so we reset the
            // completion signal and cancel any pending close timer to avoid
            // prematurely closing the stream.
            if (payload.chunk.type === 'RUN_STARTED') {
              runStartedSeen = true
              runCompletedEventSeen = false
              clearRunCompletedCloseTimer()
              lastErrorInfoMap.delete(conversationId)
              pendingToolResultIds.clear()
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
              if (pendingToolResultIds.size > 0) {
                // Tool calls are awaiting approval — don't close immediately.
                // Use the grace timer so the CUSTOM approval metadata chunk
                // has time to arrive before the stream shuts down.
                scheduleRunCompletedClose()
              } else {
                clearFallbackCloseTimer()
                clearRunCompletedCloseTimer()
                closeStream('terminal-chunk')
              }
            }
            if (!isTerminalChunk(payload.chunk) && runCompletedEventSeen) {
              // Allow a short grace period for in-flight chunks that arrive
              // around run-completed, then close if no terminal chunk appears.
              scheduleRunCompletedClose()
            }

            // Wake up the consumer if it's waiting
            resolve?.()
          })
          const runCompletedUnsub = api.onRunCompleted((payload) => {
            if (payload.conversationId !== conversationId) {
              return
            }
            // Ignore run-completed events from a previous (aborted) run that
            // arrive before this adapter has seen its own RUN_STARTED chunk.
            // Without this guard, a steer flow's old run completion can
            // prematurely close the new run's stream.
            if (!runStartedSeen) {
              return
            }
            runCompletedEventSeen = true
            clearFallbackCloseTimer()
            traceApproval('run-completed-event')
            // Do not close immediately: in practice, run-completed can race
            // slightly ahead of final stream chunks (text deltas / RUN_FINISHED).
            // Keep the stream open briefly to drain late chunks.
            scheduleRunCompletedClose()
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
              clearFallbackCloseTimer()
              unsub()
              closeStream('abort')
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
          const useContinuationPayload = shouldUseContinuationPayload(_messages)
          approvalTraceActive = approvalTraceEnabled && useContinuationPayload
          const lastMessage = _messages[_messages.length - 1]
          const lastMessageIsUser = Boolean(lastMessage && lastMessage.role === 'user')

          if (approvalTraceActive) {
            traceApproval('send', {
              continuationMessageFormat: describeContinuationMessageFormat(_messages),
              lastMessageRole: lastMessage?.role ?? null,
              hasPendingPayload: pendingPayload !== null,
              useContinuationPayload,
            })
          }

          if (!pendingPayload && !useContinuationPayload && !lastMessageIsUser) {
            const errMsg =
              'Cannot continue prior tool state because no pending payload or approval context was found. Send your message again.'
            const info = classifyErrorMessage(errMsg)
            lastErrorInfoMap.set(conversationId, info)
            const errorChunk: StreamChunk = {
              type: 'RUN_ERROR',
              timestamp: Date.now(),
              error: { message: errMsg },
            }
            queue.push(errorChunk)
            done = true
          }
          if (!done) {
            const payload =
              pendingPayload ??
              (useContinuationPayload
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
                // Keep the stream alive until either:
                // 1) a terminal chunk arrives, or
                // 2) the explicit run-completed event is emitted.
                //
                // The fallback timer is defensive in case a run-completed event
                // is ever missed; it avoids infinite hanging streams.
                traceApproval('send-resolved')
                scheduleFallbackClose()
              })
              .catch((err) => {
                ipcLogger.error('[ipc-adapter] sendMessage failed', {
                  error: err instanceof Error ? err.message : String(err),
                })
                const errMsg = err instanceof Error ? err.message : String(err)
                const info = classifyErrorMessage(errMsg)
                lastErrorInfoMap.set(conversationId, info)
                const errorChunk: StreamChunk = {
                  type: 'RUN_ERROR',
                  timestamp: Date.now(),
                  error: { message: errMsg },
                }
                queue.push(errorChunk)
                clearFallbackCloseTimer()
                closeStream('send-error')
              })
          }

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
            clearFallbackCloseTimer()
            unsub()
          }
        },
      }
    },
  }
}
