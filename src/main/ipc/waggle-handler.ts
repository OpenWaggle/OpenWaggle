import { safeDecodeUnknown } from '@shared/schema'
import { waggleConfigSchema } from '@shared/schemas/waggle'
import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { classifyAgentError, makeErrorInfo } from '../agent/error-classifier'
import { buildPersistedUserMessageParts, makeMessage } from '../agent/shared'
import { generateTitle } from '../agent/title-generator'
import { runWaggleSequential } from '../agent/waggle-coordinator'
import { createLogger } from '../logger'
import { withConversationLock } from '../store/conversation-lock'
import { getConversation, saveConversation } from '../store/conversations'
import { getSettings } from '../store/settings'
import {
  clearAgentPhase,
  clearStreamBuffer,
  emitRunCompleted,
  emitStreamChunk,
  emitWaggleStreamChunk,
  emitWaggleTurnEvent,
  startStreamBuffer,
} from '../utils/stream-bridge'
import { hydrateAttachmentSources } from './attachments-handler'
import { typedHandle, typedOn } from './typed-ipc'

const logger = createLogger('waggle-handler')

const activeWaggleRuns = new Map<ConversationId, AbortController>()

export function registerWaggleHandlers(): void {
  typedHandle(
    'agent:send-waggle-message',
    (_event, conversationId: ConversationId, payload: AgentSendPayload, config: WaggleConfig) =>
      Effect.gen(function* () {
        // Validate config at IPC boundary
        const parseResult = safeDecodeUnknown(waggleConfigSchema, config)
        if (!parseResult.success) {
          emitStreamChunk(conversationId, {
            type: 'RUN_ERROR',
            timestamp: Date.now(),
            error: { message: 'Invalid Waggle mode configuration', code: 'validation-error' },
          })
          return
        }

        // Cancel any existing Waggle run for this conversation.
        const existing = activeWaggleRuns.get(conversationId)
        if (existing) {
          existing.abort()
          activeWaggleRuns.delete(conversationId)
          clearAgentPhase(conversationId)
        }

        const abortController = new AbortController()
        activeWaggleRuns.set(conversationId, abortController)

        const settings = getSettings()
        const conversation = yield* Effect.promise(() => getConversation(conversationId))

        if (!conversation) {
          const errorInfo = makeErrorInfo('conversation-not-found', 'Conversation not found')
          emitStreamChunk(conversationId, {
            type: 'RUN_ERROR',
            timestamp: Date.now(),
            error: { message: errorInfo.userMessage, code: errorInfo.code },
          })
          activeWaggleRuns.delete(conversationId)
          return
        }

        // Waggle mode requires a project because agents need tool access.
        if (!conversation.projectPath) {
          emitStreamChunk(conversationId, {
            type: 'RUN_ERROR',
            timestamp: Date.now(),
            error: {
              message: 'Please select a project folder before starting Waggle mode.',
              code: 'no-project',
            },
          })
          activeWaggleRuns.delete(conversationId)
          return
        }

        // Fire-and-forget LLM title generation on first message
        if (conversation.title === 'New thread' && conversation.messages.length === 0) {
          const trimmed = payload.text.trim()
          if (trimmed) {
            void generateTitle(conversationId, trimmed, settings)
          }
        }

        // Capture base messages before run for incremental persistence
        const baseMessages = [...conversation.messages]

        startStreamBuffer(conversationId, config.agents[0].model, 'waggle')

        yield* Effect.ensuring(
          Effect.gen(function* () {
            const hydratedPayload = {
              ...payload,
              attachments: yield* Effect.promise(() =>
                hydrateAttachmentSources(payload.attachments),
              ),
            }

            emitStreamChunk(conversationId, {
              type: 'RUN_STARTED',
              timestamp: Date.now(),
              runId: `waggle-${conversationId}`,
            })

            let lastEmittedTurn = -1
            let pendingBoundary: {
              agentIndex: number
              agentLabel: string
              agentColor: string
              agentModel: string | undefined
              turnNumber: number
              isSynthesis?: boolean
            } | null = null

            const result = yield* Effect.tryPromise({
              try: () =>
                runWaggleSequential({
                  conversationId,
                  conversation,
                  payload: hydratedPayload,
                  config,
                  settings,
                  signal: abortController.signal,
                  onTurnComplete: async (accumulatedMessages) => {
                    await withConversationLock(conversationId, async () => {
                      const latest = await getConversation(conversationId)
                      if (!latest) return
                      await saveConversation({
                        ...latest,
                        messages: [...baseMessages, ...accumulatedMessages],
                        waggleConfig: config,
                      })
                    })
                  },
                  onStreamChunk: (chunk, meta) => {
                    emitWaggleStreamChunk(conversationId, chunk, meta)

                    if (
                      chunk.type === 'RUN_STARTED' ||
                      chunk.type === 'RUN_FINISHED' ||
                      chunk.type === 'RUN_ERROR'
                    ) {
                      return
                    }

                    // When a new turn starts, defer the boundary injection
                    // until we see the first text-bearing chunk. This ensures
                    // the boundary always appears immediately before text,
                    // preventing TanStack from appending new-turn text to the
                    // previous turn's open TextPart.
                    if (meta.turnNumber > lastEmittedTurn) {
                      if (meta.turnNumber > 0) {
                        pendingBoundary = {
                          agentIndex: meta.agentIndex,
                          agentLabel: meta.agentLabel,
                          agentColor: meta.agentColor,
                          agentModel: meta.agentModel,
                          turnNumber: meta.turnNumber,
                          ...(meta.isSynthesis ? { isSynthesis: true } : {}),
                        }
                      }
                      lastEmittedTurn = meta.turnNumber
                    }

                    // Flush the pending boundary right before the first
                    // TEXT_DELTA or TEXT_MESSAGE_START of the new turn.
                    if (
                      pendingBoundary &&
                      (chunk.type === 'TEXT_DELTA' || chunk.type === 'TEXT_MESSAGE_START')
                    ) {
                      const b = pendingBoundary
                      const boundaryId = b.isSynthesis
                        ? 'turn-boundary-synthesis'
                        : `turn-boundary-${String(b.turnNumber)}`
                      const boundaryMeta = JSON.stringify({
                        agentIndex: b.agentIndex,
                        agentLabel: b.agentLabel,
                        agentColor: b.agentColor,
                        agentModel: b.agentModel,
                        turnNumber: b.turnNumber,
                        ...(b.isSynthesis ? { isSynthesis: true } : {}),
                      })
                      emitStreamChunk(conversationId, {
                        type: 'TOOL_CALL_START',
                        timestamp: Date.now(),
                        toolCallId: boundaryId,
                        toolName: '_turnBoundary',
                      })
                      emitStreamChunk(conversationId, {
                        type: 'TOOL_CALL_END',
                        timestamp: Date.now(),
                        toolCallId: boundaryId,
                        toolName: '_turnBoundary',
                        result: boundaryMeta,
                        input: {},
                      })
                      pendingBoundary = null
                    }

                    emitStreamChunk(conversationId, chunk)
                  },
                  onTurnEvent: (event) => {
                    emitWaggleTurnEvent(conversationId, event)
                  },
                }),
              catch: (err) => err,
            })

            // Persist whatever we have BEFORE emitting finish/error events.
            // This ensures refreshConversationSnapshot won't load empty state.
            if (result.newMessages.length > 0) {
              yield* Effect.tryPromise({
                try: () =>
                  withConversationLock(conversationId, async () => {
                    const latestConversation = await getConversation(conversationId)
                    if (!latestConversation) return
                    const updatedMessages = [...baseMessages, ...result.newMessages]
                    await saveConversation({
                      ...latestConversation,
                      messages: updatedMessages,
                      waggleConfig: config,
                    })
                  }),
                catch: (persistError) => persistError,
              }).pipe(
                Effect.catchAll((persistError) =>
                  Effect.sync(() =>
                    logger.error('Failed to persist Waggle conversation', {
                      conversationId,
                      error:
                        persistError instanceof Error ? persistError.message : String(persistError),
                    }),
                  ),
                ),
              )
            }

            if (abortController.signal.aborted || result.newMessages.length === 0) {
              emitStreamChunk(conversationId, {
                type: 'RUN_FINISHED',
                timestamp: Date.now(),
                runId: `waggle-${conversationId}`,
                finishReason: 'stop',
              })
              return
            }

            const assistantCount = result.newMessages.filter((m) => m.role === 'assistant').length
            if (assistantCount === 0 && result.lastError) {
              const classified = classifyAgentError(new Error(result.lastError))
              emitStreamChunk(conversationId, {
                type: 'RUN_ERROR',
                timestamp: Date.now(),
                error: { message: classified.userMessage, code: classified.code },
              })
              emitStreamChunk(conversationId, {
                type: 'RUN_FINISHED',
                timestamp: Date.now(),
                runId: `waggle-${conversationId}`,
                finishReason: 'stop',
              })
              return
            }

            emitStreamChunk(conversationId, {
              type: 'RUN_FINISHED',
              timestamp: Date.now(),
              runId: `waggle-${conversationId}`,
              finishReason: 'stop',
            })
          }).pipe(
            Effect.catchAll((err) => {
              if (err instanceof Error && err.message === 'aborted') {
                return Effect.void
              }
              return Effect.gen(function* () {
                // Persist user message so snapshot refresh doesn't show empty state.
                // Only add if onTurnComplete hasn't already saved progress.
                yield* Effect.tryPromise({
                  try: () =>
                    withConversationLock(conversationId, async () => {
                      const conv = await getConversation(conversationId)
                      if (!conv) return
                      if (conv.messages.length <= baseMessages.length) {
                        const userMessage = makeMessage(
                          'user',
                          buildPersistedUserMessageParts(payload),
                        )
                        await saveConversation({
                          ...conv,
                          messages: [...conv.messages, userMessage],
                          waggleConfig: config,
                        })
                      }
                    }),
                  catch: (e) => e,
                }).pipe(Effect.catchAll(() => Effect.void))

                const classified = classifyAgentError(err)
                emitStreamChunk(conversationId, {
                  type: 'RUN_ERROR',
                  timestamp: Date.now(),
                  error: { message: classified.userMessage, code: classified.code },
                })
                emitStreamChunk(conversationId, {
                  type: 'RUN_FINISHED',
                  timestamp: Date.now(),
                  runId: `waggle-${conversationId}`,
                  finishReason: 'stop',
                })
              })
            }),
          ),
          Effect.sync(() => {
            activeWaggleRuns.delete(conversationId)
            clearStreamBuffer(conversationId)
            emitRunCompleted(conversationId)
          }),
        )
      }),
  )

  typedOn('agent:cancel-waggle', (_event, conversationId: ConversationId) =>
    Effect.sync(() => {
      const controller = activeWaggleRuns.get(conversationId)
      if (controller) {
        controller.abort()
        activeWaggleRuns.delete(conversationId)
      }
      clearAgentPhase(conversationId)
    }),
  )
}
