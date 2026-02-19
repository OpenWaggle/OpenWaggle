import { isTextPart } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { QuestionAnswer } from '@shared/types/question'
import { ipcMain } from 'electron'
import { runAgent } from '../agent/agent-loop'
import { getConversation, saveConversation } from '../store/conversations'
import { getSettings } from '../store/settings'
import { answerQuestion, cancelQuestion } from '../tools/question-manager'
import { emitStreamChunk } from '../utils/stream-bridge'

/** Per-conversation abort controllers — allows concurrent runs on different conversations */
const activeRuns = new Map<ConversationId, AbortController>()

export function registerAgentHandlers(): void {
  ipcMain.handle(
    'agent:send-message',
    async (_event, conversationId: ConversationId, content: string, model: SupportedModelId) => {
      // Cancel any existing run for this conversation
      const existing = activeRuns.get(conversationId)
      if (existing) {
        existing.abort()
      }

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
        const trimmed = content.trim()
        if (trimmed) {
          const provisionalTitle = trimmed.slice(0, 60) + (trimmed.length > 60 ? '...' : '')
          await saveConversation({ ...conversation, title: provisionalTitle })
        }
      }

      try {
        const { newMessages } = await runAgent({
          conversation,
          userMessage: content,
          model,
          settings,
          onChunk: (chunk) => emitStreamChunk(conversationId, chunk),
          signal: abortController.signal,
        })

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
      cancelQuestion(conversationId)
    } else {
      // Cancel all active runs (backward compat)
      for (const [id, controller] of activeRuns) {
        controller.abort()
        activeRuns.delete(id)
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
