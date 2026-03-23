import { safeDecodeUnknown } from '@shared/schema'
import { waggleConfigSchema } from '@shared/schemas/waggle'
import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { classifyAgentError, makeErrorInfo } from '../agent/error-classifier'
import { buildPersistedUserMessageParts, makeMessage } from '../agent/shared'
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
import {
  emitErrorAndFinish,
  hydratePayloadAttachments,
  maybeTriggerTitleGeneration,
} from './run-handler-utils'
import { typedHandle, typedOn } from './typed-ipc'

const logger = createLogger('waggle-handler')

const activeWaggleRuns = new Map<ConversationId, AbortController>()
const BASE36_RADIX = 36
const RANDOM_TOKEN_START = 2

function createRunScopedMessageToken(): string {
  return `${Date.now().toString(BASE36_RADIX)}-${Math.random()
    .toString(BASE36_RADIX)
    .slice(RANDOM_TOKEN_START)}`
}

function getStableTurnMessageId(
  conversationId: ConversationId,
  runToken: string,
  turnNumber: number,
  turnMessageIds: Map<number, string>,
): string {
  const existing = turnMessageIds.get(turnNumber)
  if (existing) {
    return existing
  }

  const stableMessageId = `waggle-${String(conversationId)}-${runToken}-turn-${String(turnNumber)}`
  turnMessageIds.set(turnNumber, stableMessageId)
  return stableMessageId
}

export function registerWaggleHandlers(): void {
  typedHandle(
    'agent:send-waggle-message',
    (_event, conversationId: ConversationId, payload: AgentSendPayload, config: WaggleConfig) =>
      Effect.gen(function* () {
        // Validate config at IPC boundary
        const parseResult = safeDecodeUnknown(waggleConfigSchema, config)
        if (!parseResult.success) {
          emitErrorAndFinish(
            conversationId,
            'Invalid Waggle mode configuration',
            'validation-error',
          )
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
          emitErrorAndFinish(conversationId, errorInfo.userMessage, errorInfo.code)
          activeWaggleRuns.delete(conversationId)
          return
        }

        // Waggle mode requires a project because agents need tool access.
        if (!conversation.projectPath) {
          emitErrorAndFinish(
            conversationId,
            'Please select a project folder before starting Waggle mode.',
            'no-project',
          )
          activeWaggleRuns.delete(conversationId)
          return
        }

        maybeTriggerTitleGeneration(conversationId, conversation, payload.text, settings)

        // Capture base messages before run for incremental persistence
        const baseMessages = [...conversation.messages]

        startStreamBuffer(conversationId, config.agents[0].model, 'waggle')

        yield* Effect.ensuring(
          Effect.gen(function* () {
            const hydratedPayload = {
              ...payload,
              attachments: yield* Effect.promise(() =>
                hydratePayloadAttachments(payload.attachments),
              ),
            }

            emitStreamChunk(conversationId, {
              type: 'RUN_STARTED',
              timestamp: Date.now(),
              runId: `waggle-${conversationId}`,
            })

            let lastEmittedTurn = -1
            const runScopedMessageToken = createRunScopedMessageToken()
            const turnMessageIds = new Map<number, string>()

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
                    if (
                      chunk.type === 'RUN_STARTED' ||
                      chunk.type === 'RUN_FINISHED' ||
                      chunk.type === 'RUN_ERROR'
                    ) {
                      emitWaggleStreamChunk(conversationId, chunk, meta)
                      return
                    }

                    // Normalize all text message chunk IDs to one stable ID per turn.
                    // TanStack AI creates/looks up assistant UIMessages by messageId,
                    // so this guarantees exactly one assistant UIMessage per waggle turn.
                    if (
                      chunk.type === 'TEXT_MESSAGE_START' ||
                      chunk.type === 'TEXT_MESSAGE_CONTENT' ||
                      chunk.type === 'TEXT_MESSAGE_END'
                    ) {
                      const stableMessageId = getStableTurnMessageId(
                        conversationId,
                        runScopedMessageToken,
                        meta.turnNumber,
                        turnMessageIds,
                      )
                      if (chunk.messageId !== stableMessageId) {
                        chunk = { ...chunk, messageId: stableMessageId }
                      }
                    }

                    emitWaggleStreamChunk(conversationId, chunk, meta)

                    // Emit turn boundary IMMEDIATELY on first chunk of a new turn.
                    // This ensures tool calls from the new turn don't land in the
                    // previous turn's segment.
                    // Synthesis chunks are excluded — the final synthesis renders as
                    // a plain assistant message without waggle styling or boundaries.
                    if (meta.turnNumber > lastEmittedTurn) {
                      if (meta.turnNumber > 0 && !meta.isSynthesis) {
                        const boundaryId = meta.isSynthesis
                          ? 'turn-boundary-synthesis'
                          : `turn-boundary-${String(meta.turnNumber)}`
                        const boundaryMeta = JSON.stringify({
                          agentIndex: meta.agentIndex,
                          agentLabel: meta.agentLabel,
                          agentColor: meta.agentColor,
                          agentModel: meta.agentModel,
                          turnNumber: meta.turnNumber,
                          ...(meta.isSynthesis ? { isSynthesis: true } : {}),
                        })
                        emitStreamChunk(conversationId, {
                          type: 'TOOL_CALL_START',
                          timestamp: Date.now(),
                          toolCallId: boundaryId,
                          toolName: '_turnBoundary',
                        })
                        emitStreamChunk(conversationId, {
                          type: 'TOOL_CALL_ARGS',
                          timestamp: Date.now(),
                          toolCallId: boundaryId,
                          delta: boundaryMeta,
                        })
                        emitStreamChunk(conversationId, {
                          type: 'TOOL_CALL_END',
                          timestamp: Date.now(),
                          toolCallId: boundaryId,
                          toolName: '_turnBoundary',
                          result: boundaryMeta,
                          input: {},
                        })
                      }
                      lastEmittedTurn = meta.turnNumber
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
              emitErrorAndFinish(
                conversationId,
                classified.userMessage,
                classified.code,
                `waggle-${conversationId}`,
              )
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
                emitErrorAndFinish(
                  conversationId,
                  classified.userMessage,
                  classified.code,
                  `waggle-${conversationId}`,
                )
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
