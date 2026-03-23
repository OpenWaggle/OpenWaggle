import type { AgentSendPayload, HydratedAgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { PlanResponse } from '@shared/types/plan'
import type { QuestionAnswer } from '@shared/types/question'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { runAgent } from '../agent/agent-loop'
import { cleanupConversationRun } from '../agent/conversation-cleanup'
import { classifyAgentError, makeErrorInfo } from '../agent/error-classifier'
import { getPhaseForConversation } from '../agent/phase-tracker'
import { buildPersistedUserMessageParts, makeMessage } from '../agent/shared'
import type { StreamPartCollector } from '../agent/stream-part-collector'
import { approvalTraceEnabled } from '../env'
import { createLogger } from '../logger'
import { providerRegistry } from '../providers/registry'
import { withConversationLock } from '../store/conversation-lock'
import { getConversation, saveConversation } from '../store/conversations'
import { getSettings } from '../store/settings'
import { pushContext } from '../tools/context-injection-buffer'
import { respondToPlan } from '../tools/plan-manager'
import { answerQuestion } from '../tools/question-manager'
import {
  clearAgentPhase,
  clearStreamBuffer,
  emitRunCompleted,
  emitStreamChunk,
  getStreamBuffer,
  listStreamBuffers,
  startStreamBuffer,
} from '../utils/stream-bridge'
import { ActiveRunManager } from './active-run-manager'
import {
  emitErrorAndFinish,
  hydratePayloadAttachments,
  maybeTriggerTitleGeneration,
  persistUserMessageOnFailure,
} from './run-handler-utils'
import { typedHandle, typedOn } from './typed-ipc'

const logger = createLogger('agent-handler')
const approvalTraceLogger = createLogger('approval-trace')

interface AgentRunMetadata {
  collector: StreamPartCollector | null
  model: SupportedModelId
  payload: HydratedAgentSendPayload | null
}

/** Per-conversation active runs — allows concurrent runs on different conversations */
const activeRuns = new ActiveRunManager<ConversationId, AgentRunMetadata>()

export function registerAgentHandlers(): void {
  typedHandle(
    'agent:send-message',
    (_event, conversationId: ConversationId, payload: AgentSendPayload, model: SupportedModelId) =>
      Effect.gen(function* () {
        // Cancel any existing run for this conversation
        if (activeRuns.has(conversationId)) {
          activeRuns.cancel(conversationId)
          clearAgentPhase(conversationId)
        }
        cleanupConversationRun(conversationId)

        const abortController = new AbortController()
        activeRuns.register(conversationId, abortController, {
          collector: null,
          model,
          payload: null,
        })

        const settings = getSettings()

        if (!providerRegistry.isKnownModel(model)) {
          yield* Effect.promise(() => persistUserMessageOnFailure(conversationId, payload))
          emitErrorAndFinish(conversationId, `Unknown model: ${model}`, 'invalid-model')
          activeRuns.delete(conversationId)
          return
        }

        const conversation = yield* Effect.promise(() => getConversation(conversationId))

        if (!conversation) {
          const errorInfo = makeErrorInfo('conversation-not-found', 'Conversation not found')
          emitErrorAndFinish(conversationId, errorInfo.userMessage, errorInfo.code)
          activeRuns.delete(conversationId)
          return
        }

        maybeTriggerTitleGeneration(conversationId, conversation, payload.text, settings)

        startStreamBuffer(conversationId, model, 'classic')

        yield* Effect.ensuring(
          Effect.gen(function* () {
            const hydratedPayload = {
              ...payload,
              attachments: yield* Effect.promise(() =>
                hydratePayloadAttachments(payload.attachments),
              ),
            }

            const classic = yield* Effect.tryPromise({
              try: () =>
                runAgent({
                  conversation,
                  payload: hydratedPayload,
                  model,
                  settings,
                  onChunk: (chunk) => emitStreamChunk(conversationId, chunk),
                  signal: abortController.signal,
                  onCollectorCreated: (c) => {
                    const entry = activeRuns.get(conversationId)
                    if (entry) {
                      entry.metadata.collector = c
                      entry.metadata.model = model
                      entry.metadata.payload = hydratedPayload
                    }
                  },
                }),
              catch: (err) => err,
            })
            const newMessages = classic.newMessages

            if (abortController.signal.aborted || newMessages.length === 0) {
              return
            }

            yield* Effect.tryPromise({
              try: () =>
                withConversationLock(conversationId, async () => {
                  const latestConversation = await getConversation(conversationId)
                  if (!latestConversation) {
                    return
                  }

                  const updatedMessages = [...latestConversation.messages, ...newMessages]
                  await saveConversation({ ...latestConversation, messages: updatedMessages })

                  if (
                    approvalTraceEnabled &&
                    (hydratedPayload.continuationMessages?.length ?? 0) > 0
                  ) {
                    const persistedAssistantMessage = newMessages.find(
                      (message) => message.role === 'assistant',
                    )
                    approvalTraceLogger.info('continuation-persisted', {
                      conversationId,
                      messageCount: updatedMessages.length,
                      persistedToolResultCount:
                        persistedAssistantMessage?.parts.filter(
                          (part) => part.type === 'tool-result',
                        ).length ?? 0,
                      persistedToolCallCount:
                        persistedAssistantMessage?.parts.filter((part) => part.type === 'tool-call')
                          .length ?? 0,
                    })
                  }
                }),
              catch: (persistError) => {
                logger.error('Failed to persist conversation', {
                  conversationId,
                  error: formatErrorMessage(persistError),
                })
                if (
                  approvalTraceEnabled &&
                  (hydratedPayload.continuationMessages?.length ?? 0) > 0
                ) {
                  approvalTraceLogger.error('continuation-persist-failed', {
                    conversationId,
                    error: formatErrorMessage(persistError),
                  })
                }
                const persistInfo = makeErrorInfo(
                  'persist-failed',
                  'Failed to save conversation data to disk.',
                )
                emitStreamChunk(conversationId, {
                  type: 'RUN_ERROR',
                  timestamp: Date.now(),
                  error: { message: persistInfo.userMessage, code: persistInfo.code },
                })
                return persistError
              },
            }).pipe(Effect.ignore)
          }).pipe(
            Effect.catchAll((err) => {
              if (err instanceof Error && err.message === 'aborted') {
                return Effect.void
              }
              return Effect.gen(function* () {
                yield* Effect.promise(() =>
                  persistUserMessageOnFailure(conversationId, payload),
                ).pipe(
                  Effect.catchAll((persistError) =>
                    Effect.sync(() =>
                      logger.error('Failed to persist user message after run error', {
                        conversationId,
                        error: formatErrorMessage(persistError),
                      }),
                    ),
                  ),
                )
                const classified = classifyAgentError(err)
                emitErrorAndFinish(conversationId, classified.userMessage, classified.code)
              })
            }),
          ),
          Effect.sync(() => {
            activeRuns.delete(conversationId)
            clearAgentPhase(conversationId)
            clearStreamBuffer(conversationId)
            emitRunCompleted(conversationId)
          }),
        )
      }),
  )

  typedOn('agent:cancel', (_event, conversationId?: ConversationId) =>
    Effect.sync(() => {
      if (conversationId) {
        activeRuns.cancel(conversationId)
        clearAgentPhase(conversationId)
        cleanupConversationRun(conversationId)
      } else {
        // Cancel all active runs (backward compat)
        const allKeys = [...activeRuns.keys()]
        activeRuns.cancelAll()
        for (const id of allKeys) {
          clearAgentPhase(id)
          cleanupConversationRun(id)
        }
      }
    }),
  )

  typedOn('agent:inject-context', (_event, conversationId: ConversationId, text: string) =>
    Effect.sync(() => pushContext(conversationId, text)),
  )

  typedHandle('agent:get-phase', (_event, conversationId: ConversationId) =>
    Effect.sync(() => getPhaseForConversation(conversationId)),
  )

  typedHandle('agent:get-background-run', (_event, conversationId: ConversationId) =>
    Effect.sync(() => getStreamBuffer(conversationId)),
  )

  typedHandle('agent:list-active-runs', () => Effect.sync(() => listStreamBuffers()))

  typedHandle(
    'agent:answer-question',
    (_event, conversationId: ConversationId, answers: QuestionAnswer[]) =>
      Effect.sync(() => answerQuestion(conversationId, answers)),
  )

  typedHandle('agent:steer', (_event, conversationId: ConversationId) =>
    Effect.gen(function* () {
      const entry = activeRuns.get(conversationId)
      if (!entry) return { preserved: false }

      // Orchestration or early stage: no collector yet
      if (!entry.metadata.collector || !entry.metadata.payload) {
        activeRuns.cancel(conversationId)
        clearAgentPhase(conversationId)
        cleanupConversationRun(conversationId)
        return { preserved: false }
      }

      // Snapshot partial response synchronously before any async work.
      const partialParts = entry.metadata.collector.finalizeParts()
      const resolvedModel = entry.metadata.model
      const originalPayload = entry.metadata.payload

      yield* Effect.tryPromise({
        try: () =>
          withConversationLock(conversationId, async () => {
            const conv = await getConversation(conversationId)
            if (!conv) return
            const userMsg = makeMessage('user', buildPersistedUserMessageParts(originalPayload))
            const assistantMsg = makeMessage('assistant', partialParts, resolvedModel)
            await saveConversation({
              ...conv,
              messages: [...conv.messages, userMsg, assistantMsg],
            })
          }),
        catch: (err) => err,
      }).pipe(
        Effect.catchAll((err) =>
          Effect.sync(() =>
            logger.error('Failed to persist partial response during steer', {
              conversationId,
              error: formatErrorMessage(err),
            }),
          ),
        ),
      )

      // Abort the run
      activeRuns.cancel(conversationId)
      clearAgentPhase(conversationId)
      cleanupConversationRun(conversationId)

      return { preserved: true }
    }),
  )

  typedHandle(
    'agent:respond-to-plan',
    (_event, conversationId: ConversationId, response: PlanResponse) =>
      Effect.sync(() => respondToPlan(conversationId, response)),
  )
}
