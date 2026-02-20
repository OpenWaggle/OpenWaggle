import { randomUUID } from 'node:crypto'
import type { AgentSendPayload, Message } from '@shared/types/agent'
import { isTextPart } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { QuestionAnswer } from '@shared/types/question'
import { ipcMain } from 'electron'
import { runAgent } from '../agent/agent-loop'
import { createLogger } from '../logger'
import {
  cancelAllForConversation,
  registerActiveOrchestrationRun,
  unregisterActiveOrchestrationRun,
} from '../orchestration/active-runs'
import { runOrchestratedAgent } from '../orchestration/service'
import { withConversationLock } from '../store/conversation-lock'
import { getConversation, saveConversation } from '../store/conversations'
import { getSettings } from '../store/settings'
import { answerQuestion, cancelQuestion } from '../tools/question-manager'
import { emitOrchestrationEvent, emitStreamChunk } from '../utils/stream-bridge'

const logger = createLogger('agent-handler')

/** Per-conversation abort controllers — allows concurrent runs on different conversations */
const activeRuns = new Map<ConversationId, AbortController>()

export function registerAgentHandlers(): void {
  ipcMain.handle(
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
        existing.abort()
      }
      cancelAllForConversation(conversationId)

      const abortController = new AbortController()
      activeRuns.set(conversationId, abortController)

      const settings = getSettings()
      const conversation = await getConversation(conversationId)

      if (!conversation) {
        emitStreamChunk(conversationId, {
          type: 'RUN_ERROR',
          timestamp: Date.now(),
          error: { message: 'Conversation not found' },
        })
        emitStreamChunk(conversationId, {
          type: 'RUN_FINISHED',
          timestamp: Date.now(),
          runId: '',
          finishReason: 'stop',
        })
        activeRuns.delete(conversationId)
        return
      }

      if (conversation.title === 'New thread' && conversation.messages.length === 0) {
        const trimmed = payload.text.trim()
        if (trimmed) {
          const provisionalTitle = trimmed.slice(0, 60) + (trimmed.length > 60 ? '...' : '')
          await saveConversation({ ...conversation, title: provisionalTitle })
        }
      }

      try {
        let newMessages: readonly Message[]
        if (settings.orchestrationMode !== 'classic') {
          const orchestrationRunId = randomUUID()
          registerActiveOrchestrationRun(orchestrationRunId, conversationId, abortController)
          try {
            const orchestratedResult = await runOrchestratedAgent({
              runId: orchestrationRunId,
              conversationId,
              conversation,
              payload,
              model,
              settings,
              emitChunk: (chunk) => emitStreamChunk(conversationId, chunk),
              emitEvent: (event) => emitOrchestrationEvent(event),
              signal: abortController.signal,
            })

            if (orchestratedResult.status === 'fallback') {
              const classic = await runAgent({
                conversation,
                payload,
                model,
                settings,
                onChunk: (chunk) => emitStreamChunk(conversationId, chunk),
                signal: abortController.signal,
              })
              newMessages = classic.newMessages
            } else {
              newMessages = orchestratedResult.newMessages ?? []
            }
          } finally {
            unregisterActiveOrchestrationRun(orchestrationRunId)
          }
        } else {
          const classic = await runAgent({
            conversation,
            payload,
            model,
            settings,
            onChunk: (chunk) => emitStreamChunk(conversationId, chunk),
            signal: abortController.signal,
          })
          newMessages = classic.newMessages
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
            if (updatedMessages.length <= 2 && title === 'New thread') {
              const firstUserMsg = updatedMessages.find((m) => m.role === 'user')
              if (firstUserMsg) {
                const text = firstUserMsg.parts
                  .filter(isTextPart)
                  .map((p) => p.text)
                  .join(' ')
                title = text.slice(0, 60) + (text.length > 60 ? '...' : '')
              }
            }

            await saveConversation({ ...latestConversation, title, messages: updatedMessages })
          })
        } catch (persistError) {
          logger.error('Failed to persist conversation', {
            conversationId,
            error: persistError instanceof Error ? persistError.message : String(persistError),
          })
          emitStreamChunk(conversationId, {
            type: 'RUN_ERROR',
            timestamp: Date.now(),
            error: { message: 'Failed to save conversation data to disk.' },
          })
        }
      } catch (err) {
        if (!(err instanceof Error && err.message === 'aborted')) {
          emitStreamChunk(conversationId, {
            type: 'RUN_ERROR',
            timestamp: Date.now(),
            error: { message: err instanceof Error ? err.message : String(err) },
          })
          emitStreamChunk(conversationId, {
            type: 'RUN_FINISHED',
            timestamp: Date.now(),
            runId: '',
            finishReason: 'stop',
          })
        }
      } finally {
        activeRuns.delete(conversationId)
      }
    },
  )

  ipcMain.on('agent:cancel', (_event, conversationId?: ConversationId) => {
    if (conversationId) {
      const controller = activeRuns.get(conversationId)
      if (controller) {
        controller.abort()
        activeRuns.delete(conversationId)
      }
      cancelAllForConversation(conversationId)
      cancelQuestion(conversationId)
    } else {
      // Cancel all active runs (backward compat)
      for (const [id, controller] of activeRuns) {
        controller.abort()
        activeRuns.delete(id)
        cancelAllForConversation(id)
        cancelQuestion(id)
      }
    }
  })

  ipcMain.handle(
    'agent:answer-question',
    (_event, conversationId: ConversationId, answers: QuestionAnswer[]) => {
      answerQuestion(conversationId, answers)
    },
  )
}
