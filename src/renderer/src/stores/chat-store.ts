import type { ConversationId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import { create } from 'zustand'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'

const logger = createRendererLogger('chat-store')

function handleStoreError(
  err: unknown,
  action: string,
  set: (state: { error: string }) => void,
): void {
  const message = err instanceof Error ? err.message : String(err)
  logger.error(`Failed to ${action}`, message)
  set({ error: `Failed to ${action}: ${message}` })
}

interface ChatState {
  // Conversation list
  conversations: ConversationSummary[]
  activeConversationId: ConversationId | null
  activeConversation: Conversation | null
  error: string | null

  // Actions
  loadConversations: () => Promise<void>
  createConversation: (projectPath: string | null) => Promise<ConversationId>
  setActiveConversation: (id: ConversationId | null) => Promise<void>
  deleteConversation: (id: ConversationId) => Promise<void>
  updateConversationProjectPath: (id: ConversationId, projectPath: string | null) => Promise<void>
  clearError: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  activeConversation: null,
  error: null,

  async loadConversations() {
    try {
      const conversations = await api.listConversations()
      set({ conversations })
    } catch (err) {
      handleStoreError(err, 'load conversations', set)
    }
  },

  async createConversation(projectPath: string | null) {
    try {
      const conv = await api.createConversation(projectPath)
      await get().loadConversations()
      set({ activeConversationId: conv.id, activeConversation: conv })
      return conv.id
    } catch (err) {
      handleStoreError(err, 'create conversation', set)
      throw err
    }
  },

  async setActiveConversation(id: ConversationId | null) {
    if (!id) {
      set({ activeConversationId: null, activeConversation: null })
      return
    }
    try {
      const conv = await api.getConversation(id)
      set({ activeConversationId: id, activeConversation: conv })
    } catch (err) {
      handleStoreError(err, 'load conversation', set)
    }
  },

  async deleteConversation(id: ConversationId) {
    try {
      await api.deleteConversation(id)
      const { activeConversationId } = get()
      if (activeConversationId === id) {
        set({ activeConversationId: null, activeConversation: null })
      }
      await get().loadConversations()
    } catch (err) {
      handleStoreError(err, 'delete conversation', set)
    }
  },

  async updateConversationProjectPath(id: ConversationId, projectPath: string | null) {
    try {
      const updated = await api.updateConversationProjectPath(id, projectPath)
      const { activeConversationId } = get()
      if (updated && activeConversationId === id) {
        set({ activeConversation: updated })
      }
      await get().loadConversations()
    } catch (err) {
      handleStoreError(err, 'update project path', set)
    }
  },

  clearError() {
    set({ error: null })
  },
}))
