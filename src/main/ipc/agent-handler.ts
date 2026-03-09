import { DOUBLE_FACTOR } from '@shared/constants/constants'
import type { AgentSendPayload, HydratedAgentSendPayload } from '@shared/types/agent'
import { isTextPart } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { PlanResponse } from '@shared/types/plan'
import type { QuestionAnswer } from '@shared/types/question'
import { formatErrorMessage } from '@shared/utils/node-error'
import { runAgent } from '../agent/agent-loop'
import { cleanupConversationRun } from '../agent/conversation-cleanup'
import { classifyAgentError, makeErrorInfo } from '../agent/error-classifier'
import { getPhaseForConversation } from '../agent/phase-tracker'
import { buildPersistedUserMessageParts, makeMessage } from '../agent/shared'
import type { StreamPartCollector } from '../agent/stream-part-collector'
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
import { hydrateAttachmentSources } from './attachments-handler'
import { typedHandle, typedOn } from './typed-ipc'

const TITLE_PREVIEW_LENGTH = 60

const logger = createLogger('agent-handler')
const approvalTraceLogger = createLogger('approval-trace')

interface ActiveRun {
  readonly controller: AbortController
  collector: StreamPartCollector | null
  model: SupportedModelId
  payload: HydratedAgentSendPayload | null
}

/** Per-conversation active runs — allows concurrent runs on different conversations */
const activeRuns = new Map<ConversationId, ActiveRun>()

/** Emit RUN_ERROR + RUN_FINISHED pair for early-exit error paths. */
function emitErrorAndFinish(conversationId: ConversationId, message: string, code: string): void {
  emitStreamChunk(conversationId, {
    type: 'RUN_ERROR',
    timestamp: Date.now(),
    error: { message, code },
  })
  emitStreamChunk(conversationId, {
    type: 'RUN_FINISHED',
    timestamp: Date.now(),
    runId: '',
    finishReason: 'stop',
  })
}

export function registerAgentHandlers(): void {
  typedHandle(
    'agent:send-message',
    async (
      _event,
      conversationId: ConversationId,
      payload: AgentSendPayload,
      model: SupportedModelId,
    ) => {
      // Cancel any existing run for this conversation
      const existing = activeRuns.get(conversationId)
      if (existing) {
        existing.controller.abort()
        activeRuns.delete(conversationId)
        clearAgentPhase(conversationId)
      }
      cleanupConversationRun(conversationId)

      const abortController = new AbortController()
      const run: ActiveRun = { controller: abortController, collector: null, model, payload: null }
      activeRuns.set(conversationId, run)

      const settings = getSettings()

      if (!providerRegistry.isKnownModel(model)) {
        emitErrorAndFinish(conversationId, `Unknown model: ${model}`, 'invalid-model')
        activeRuns.delete(conversationId)
        return
      }

      const conversation = await getConversation(conversationId)

      if (!conversation) {
        const errorInfo = makeErrorInfo('conversation-not-found', 'Conversation not found')
        emitErrorAndFinish(conversationId, errorInfo.userMessage, errorInfo.code)
        activeRuns.delete(conversationId)
        return
      }

      if (conversation.title === 'New thread' && conversation.messages.length === 0) {
        const trimmed = payload.text.trim()
        if (trimmed) {
          const provisionalTitle =
            trimmed.slice(0, TITLE_PREVIEW_LENGTH) +
            (trimmed.length > TITLE_PREVIEW_LENGTH ? '...' : '')
          await saveConversation({ ...conversation, title: provisionalTitle })
        }
      }

      startStreamBuffer(conversationId, model, 'classic')

      try {
        const hydratedPayload = {
          ...payload,
          attachments: await hydrateAttachmentSources(payload.attachments),
        }

        const classic = await runAgent({
          conversation,
          payload: hydratedPayload,
          model,
          settings,
          onChunk: (chunk) => emitStreamChunk(conversationId, chunk),
          signal: abortController.signal,
          onCollectorCreated: (c) => {
            const r = activeRuns.get(conversationId)
            if (r) {
              r.collector = c
              r.model = model
              r.payload = hydratedPayload
            }
          },
        })
        const newMessages = classic.newMessages

        if (abortController.signal.aborted || newMessages.length === 0) {
          return
        }

        try {
          await withConversationLock(conversationId, async () => {
            // Re-read the latest snapshot before persisting to avoid resurrecting
            // deleted conversations (e.g. user deletes while run is in flight).
            const latestConversation = await getConversation(conversationId)
            if (!latestConversation) {
              return
            }

            // Append new messages to the latest conversation snapshot.
            const updatedMessages = [...latestConversation.messages, ...newMessages]

            // Auto-title on first user message
            let title = latestConversation.title
            if (updatedMessages.length <= DOUBLE_FACTOR && title === 'New thread') {
              const firstUserMsg = updatedMessages.find((m) => m.role === 'user')
              if (firstUserMsg) {
                const text = firstUserMsg.parts
                  .filter(isTextPart)
                  .map((p) => p.text)
                  .join(' ')
                title =
                  text.slice(0, TITLE_PREVIEW_LENGTH) +
                  (text.length > TITLE_PREVIEW_LENGTH ? '...' : '')
              }
            }

            await saveConversation({ ...latestConversation, title, messages: updatedMessages })

            if ((hydratedPayload.continuationMessages?.length ?? 0) > 0) {
              const persistedAssistantMessage = newMessages.find(
                (message) => message.role === 'assistant',
              )
              approvalTraceLogger.info('continuation-persisted', {
                conversationId,
                messageCount: updatedMessages.length,
                persistedToolResultCount:
                  persistedAssistantMessage?.parts.filter((part) => part.type === 'tool-result')
                    .length ?? 0,
                persistedToolCallCount:
                  persistedAssistantMessage?.parts.filter((part) => part.type === 'tool-call')
                    .length ?? 0,
              })
            }
          })
        } catch (persistError) {
          logger.error('Failed to persist conversation', {
            conversationId,
            error: formatErrorMessage(persistError),
          })
          if ((hydratedPayload.continuationMessages?.length ?? 0) > 0) {
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
        }
      } catch (err) {
        if (!(err instanceof Error && err.message === 'aborted')) {
          const classified = classifyAgentError(err)
          emitErrorAndFinish(conversationId, classified.userMessage, classified.code)
        }
      } finally {
        activeRuns.delete(conversationId)
        clearAgentPhase(conversationId)
        clearStreamBuffer(conversationId)
        emitRunCompleted(conversationId)
      }
    },
  )

  typedOn('agent:cancel', (_event, conversationId?: ConversationId) => {
    if (conversationId) {
      const run = activeRuns.get(conversationId)
      if (run) {
        run.controller.abort()
        activeRuns.delete(conversationId)
      }
      clearAgentPhase(conversationId)
      cleanupConversationRun(conversationId)
    } else {
      // Cancel all active runs (backward compat)
      for (const [id, run] of activeRuns) {
        run.controller.abort()
        activeRuns.delete(id)
        clearAgentPhase(id)
        cleanupConversationRun(id)
      }
    }
  })

  typedOn('agent:inject-context', (_event, conversationId: ConversationId, text: string) => {
    pushContext(conversationId, text)
  })

  typedHandle('agent:get-phase', (_event, conversationId: ConversationId) => {
    return getPhaseForConversation(conversationId)
  })

  typedHandle('agent:get-background-run', (_event, conversationId: ConversationId) => {
    return getStreamBuffer(conversationId)
  })

  typedHandle('agent:list-active-runs', () => {
    return listStreamBuffers()
  })

  typedHandle(
    'agent:answer-question',
    (_event, conversationId: ConversationId, answers: QuestionAnswer[]) => {
      answerQuestion(conversationId, answers)
    },
  )

  typedHandle('agent:steer', async (_event, conversationId: ConversationId) => {
    const run = activeRuns.get(conversationId)
    if (!run) return { preserved: false }

    // Orchestration or early stage: no collector yet
    if (!run.collector || !run.payload) {
      run.controller.abort()
      activeRuns.delete(conversationId)
      clearAgentPhase(conversationId)
      cleanupConversationRun(conversationId)
      return { preserved: false }
    }

    // Snapshot partial response synchronously before any async work.
    const partialParts = run.collector.finalizeParts()
    const resolvedModel = run.model
    const originalPayload = run.payload

    try {
      await withConversationLock(conversationId, async () => {
        const conv = await getConversation(conversationId)
        if (!conv) return
        const userMsg = makeMessage('user', buildPersistedUserMessageParts(originalPayload))
        const assistantMsg = makeMessage('assistant', partialParts, resolvedModel)
        await saveConversation({
          ...conv,
          messages: [...conv.messages, userMsg, assistantMsg],
        })
      })
    } catch (err) {
      logger.error('Failed to persist partial response during steer', {
        conversationId,
        error: formatErrorMessage(err),
      })
    }

    // Abort the run
    run.controller.abort()
    activeRuns.delete(conversationId)
    clearAgentPhase(conversationId)
    cleanupConversationRun(conversationId)

    return { preserved: true }
  })

  typedHandle(
    'agent:respond-to-plan',
    (_event, conversationId: ConversationId, response: PlanResponse) => {
      respondToPlan(conversationId, response)
    },
  )
}
