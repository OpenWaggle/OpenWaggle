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
  logger.error(`Failed to ${action}`, { message })
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
  startDraftThread: () => void
  setActiveConversation: (id: ConversationId | null) => Promise<void>
  deleteConversation: (id: ConversationId) => Promise<void>
  updateConversationTitle: (id: ConversationId, title: string) => void
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
      const all = await api.listConversations()
      // Filter out untitled draft threads that have no messages yet —
      // these are freshly created conversations awaiting their first send.
      // They appear in the sidebar only once the LLM title is generated.
      const conversations = all.filter((c) => c.title !== 'New thread' || c.messageCount > 0)
      set({ conversations })
    } catch (err) {
      handleStoreError(err, 'load conversations', set)
    }
  },

  startDraftThread() {
    set({ activeConversationId: null, activeConversation: null })
  },

  async createConversation(projectPath: string | null) {
    try {
      const conv = await api.createConversation(projectPath)
      // Don't add to sidebar list yet — it appears once the LLM title
      // is generated and broadcast via conversations:title-updated.
      set({
        activeConversationId: conv.id,
        activeConversation: conv,
      })
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
    const snapshot = get().conversations
    const { activeConversationId } = get()
    // Optimistic update
    set({
      conversations: snapshot.filter((c) => c.id !== id),
      ...(activeConversationId === id
        ? { activeConversationId: null, activeConversation: null }
        : {}),
    })
    try {
      await api.deleteConversation(id)
    } catch (err) {
      // Rollback on failure
      set({ conversations: snapshot })
      handleStoreError(err, 'delete conversation', set)
    }
  },

  updateConversationTitle(id: ConversationId, title: string) {
    const existing = get().conversations.find((c) => c.id === id)
    if (existing) {
      set({
        conversations: get().conversations.map((c) => (c.id === id ? { ...c, title } : c)),
      })
    } else {
      // Conversation was just created (not yet in sidebar). Add it now.
      const { activeConversation } = get()
      const now = Date.now()
      const summary: ConversationSummary = {
        id,
        title,
        projectPath: activeConversation?.id === id ? activeConversation.projectPath : null,
        messageCount: 1,
        createdAt: activeConversation?.id === id ? activeConversation.createdAt : now,
        updatedAt: now,
      }
      set({ conversations: [summary, ...get().conversations] })
    }
    const { activeConversation } = get()
    if (activeConversation && activeConversation.id === id) {
      set({ activeConversation: { ...activeConversation, title } })
    }
  },

  async updateConversationProjectPath(id: ConversationId, projectPath: string | null) {
    try {
      const updated = await api.updateConversationProjectPath(id, projectPath)
      const { activeConversationId } = get()
      if (updated && activeConversationId === id) {
        set({ activeConversation: updated })
      }
      set({
        conversations: get().conversations.map((c) => (c.id === id ? { ...c, projectPath } : c)),
      })
    } catch (err) {
      handleStoreError(err, 'update project path', set)
    }
  },

  clearError() {
    set({ error: null })
  },
}))
