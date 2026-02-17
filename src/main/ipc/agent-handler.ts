import { isTextPart } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import { ipcMain } from 'electron'
import { runAgent } from '../agent/agent-loop'
import { getConversation, saveConversation } from '../store/conversations'
import { getSettings } from '../store/settings'
import { emitAgentEvent } from '../utils/stream-bridge'

let currentAbortController: AbortController | null = null

export function registerAgentHandlers(): void {
  ipcMain.handle(
    'agent:send-message',
    async (_event, conversationId: ConversationId, content: string, model: SupportedModelId) => {
      // Cancel any existing run
      if (currentAbortController) {
        currentAbortController.abort()
      }

      currentAbortController = new AbortController()
      const settings = getSettings()
      const conversation = getConversation(conversationId)

      if (!conversation) {
        emitAgentEvent({ type: 'error', error: 'Conversation not found' })
        return
      }

      try {
        const { newMessages } = await runAgent({
          conversation,
          userMessage: content,
          model,
          settings,
          onEvent: emitAgentEvent,
          signal: currentAbortController.signal,
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

        saveConversation({ ...conversation, title, messages: updatedMessages })
      } catch (err) {
        if (!(err instanceof Error && err.message === 'aborted')) {
          emitAgentEvent({
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
          })
        }
      } finally {
        currentAbortController = null
      }
    },
  )

  ipcMain.on('agent:cancel', () => {
    if (currentAbortController) {
      currentAbortController.abort()
      currentAbortController = null
    }
  })
}
