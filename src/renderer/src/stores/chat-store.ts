import type { ConversationId } from '@shared/types/brand'
import { create } from 'zustand'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'

const logger = createRendererLogger('chat-store')

interface ChatState {
  // Pure client state — which thread is selected
  activeConversationId: ConversationId | null

  // Actions
  setActiveConversationId: (id: ConversationId | null) => void
  createConversation: (projectPath: string | null) => Promise<ConversationId>
  startDraftThread: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  activeConversationId: null,

  setActiveConversationId(id: ConversationId | null) {
    set({ activeConversationId: id })
  },

  startDraftThread() {
    set({ activeConversationId: null })
  },

  async createConversation(projectPath: string | null) {
    try {
      const conv = await api.createConversation(projectPath)
      set({ activeConversationId: conv.id })
      return conv.id
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Failed to create conversation', { message })
      throw err
    }
  },
}))
