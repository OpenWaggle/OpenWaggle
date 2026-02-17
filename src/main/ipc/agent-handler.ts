import { isTextPart } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import { ipcMain } from 'electron'
import { runAgent } from '../agent/agent-loop'
import { getConversation, saveConversation } from '../store/conversations'
import { getSettings } from '../store/settings'
import { clearToolContext } from '../tools/define-tool'
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
        emitStreamChunk({
          type: 'RUN_ERROR',
          timestamp: Date.now(),
          error: { message: 'Conversation not found' },
        })
        activeRuns.delete(conversationId)
        return
      }

      try {
        const { newMessages } = await runAgent({
          conversation,
          userMessage: content,
          model,
          settings,
          onChunk: emitStreamChunk,
          signal: abortController.signal,
        })

        // Append new messages to the conversation immutably
        const updatedMessages = [...conversation.messages, ...newMessages]

        // Auto-title on first user message
        let title = conversation.title
        if (updatedMessages.length <= 2 && title === 'New Conversation') {
          const firstUserMsg = updatedMessages.find((m) => m.role === 'user')
          if (firstUserMsg) {
            const text = firstUserMsg.parts
              .filter(isTextPart)
              .map((p) => p.text)
              .join(' ')
            title = text.slice(0, 60) + (text.length > 60 ? '...' : '')
          }
        }

        await saveConversation({ ...conversation, title, messages: updatedMessages })
      } catch (err) {
        if (!(err instanceof Error && err.message === 'aborted')) {
          emitStreamChunk({
            type: 'RUN_ERROR',
            timestamp: Date.now(),
            error: { message: err instanceof Error ? err.message : String(err) },
          })
        }
      } finally {
        activeRuns.delete(conversationId)
        clearToolContext()
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
    } else {
      // Cancel all active runs (backward compat)
      for (const [id, controller] of activeRuns) {
        controller.abort()
        activeRuns.delete(id)
      }
    }
  })
}
