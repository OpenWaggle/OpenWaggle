import type { ConversationId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import { create } from 'zustand'
import { api } from '@/lib/ipc'

interface ChatState {
  // Conversation list
  conversations: ConversationSummary[]
  activeConversationId: ConversationId | null
  activeConversation: Conversation | null

  // Actions
  loadConversations: () => Promise<void>
  createConversation: (
    model: SupportedModelId,
    projectPath: string | null,
  ) => Promise<ConversationId>
  setActiveConversation: (id: ConversationId | null) => Promise<void>
  deleteConversation: (id: ConversationId) => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  activeConversation: null,

  async loadConversations() {
    const conversations = await api.listConversations()
    set({ conversations })
  },

  async createConversation(model: SupportedModelId, projectPath: string | null) {
    const conv = await api.createConversation(model, projectPath)
    await get().loadConversations()
    set({ activeConversationId: conv.id, activeConversation: conv })
    return conv.id
  },

  async setActiveConversation(id: ConversationId | null) {
    if (!id) {
      set({ activeConversationId: null, activeConversation: null })
      return
    }
    const conv = await api.getConversation(id)
    set({ activeConversationId: id, activeConversation: conv })
  },

  async deleteConversation(id: ConversationId) {
    await api.deleteConversation(id)
    const { activeConversationId } = get()
    if (activeConversationId === id) {
      set({ activeConversationId: null, activeConversation: null })
    }
    await get().loadConversations()
  },
}))
