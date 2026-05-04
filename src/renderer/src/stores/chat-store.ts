import { type ConversationId, SessionId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import { create } from 'zustand'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'
import { useComposerStore } from '@/stores/composer-store'
import { useSessionStore } from '@/stores/session-store'

const logger = createRendererLogger('chat-store')

function conversationSessionId(id: ConversationId): SessionId {
  return SessionId(String(id))
}

function optionalConversationSessionId(id: ConversationId | null): SessionId | null {
  return id ? conversationSessionId(id) : null
}

function handleStoreError(err: unknown, action: string, setError: (message: string) => void): void {
  const message = err instanceof Error ? err.message : String(err)
  logger.error(`Failed to ${action}`, { message })
  setError(`Failed to ${action}: ${message}`)
}

function toSummary(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    projectPath: conversation.projectPath,
    messageCount: conversation.messages.length,
    archived: conversation.archived,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  }
}

function shouldShowSummary(summary: ConversationSummary): boolean {
  return summary.title !== 'New session' || summary.messageCount > 0
}

function mergeSummary(
  summaries: readonly ConversationSummary[],
  summary: ConversationSummary,
): ConversationSummary[] {
  const existingIndex = summaries.findIndex((item) => item.id === summary.id)
  if (!shouldShowSummary(summary)) {
    return existingIndex === -1
      ? [...summaries]
      : summaries.filter((item) => item.id !== summary.id)
  }

  if (existingIndex === -1) {
    return [summary, ...summaries]
  }

  return summaries.map((item) => (item.id === summary.id ? summary : item))
}

function removeSummary(
  summaries: readonly ConversationSummary[],
  id: ConversationId,
): ConversationSummary[] {
  return summaries.filter((summary) => summary.id !== id)
}

interface ChatState {
  conversations: ConversationSummary[]
  conversationById: Map<ConversationId, Conversation>
  activeConversationId: ConversationId | null
  activeConversation: Conversation | null
  error: string | null

  loadConversations: () => Promise<void>
  createConversation: (projectPath: string) => Promise<ConversationId>
  startDraftSession: () => void
  setActiveConversationId: (id: ConversationId | null) => void
  setActiveConversation: (id: ConversationId | null) => void
  refreshConversation: (id: ConversationId) => Promise<void>
  upsertConversation: (conversation: Conversation) => void
  deleteConversation: (id: ConversationId) => Promise<void>
  updateConversationTitle: (id: ConversationId, title: string) => void
  clearError: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  conversationById: new Map<ConversationId, Conversation>(),
  activeConversationId: null,
  activeConversation: null,
  error: null,

  async loadConversations() {
    try {
      const all = await api.listFullConversations()
      const conversationById = new Map<ConversationId, Conversation>()
      const conversations: ConversationSummary[] = []

      for (const conversation of all) {
        conversationById.set(conversation.id, conversation)
        const summary = toSummary(conversation)
        if (shouldShowSummary(summary)) {
          conversations.push(summary)
        }
      }

      const activeConversationId = get().activeConversationId
      set({
        conversations,
        conversationById,
        activeConversation: activeConversationId
          ? (conversationById.get(activeConversationId) ?? null)
          : null,
        error: null,
      })
      void useSessionStore.getState().loadSessions()
    } catch (err) {
      handleStoreError(err, 'load conversations', (error) => set({ error }))
    }
  },

  async createConversation(projectPath: string) {
    try {
      const conversation = await api.createConversation(projectPath)
      get().upsertConversation(conversation)
      set({
        activeConversationId: conversation.id,
        activeConversation: conversation,
        error: null,
      })
      void useSessionStore.getState().refreshSessionsAndTree(conversationSessionId(conversation.id))
      return conversation.id
    } catch (err) {
      handleStoreError(err, 'create conversation', (error) => set({ error }))
      throw err
    }
  },

  startDraftSession() {
    set({ activeConversationId: null, activeConversation: null })
  },

  setActiveConversationId(id: ConversationId | null) {
    get().setActiveConversation(id)
  },

  setActiveConversation(id: ConversationId | null) {
    if (!id) {
      set({ activeConversationId: null, activeConversation: null })
      return
    }

    const cached = get().conversationById.get(id) ?? null
    set({ activeConversationId: id, activeConversation: cached })

    if (!cached) {
      void get().refreshConversation(id)
    }
  },

  async refreshConversation(id: ConversationId) {
    try {
      const conversation = await api.getConversation(id)
      if (!conversation) return
      get().upsertConversation(conversation)
      void useSessionStore.getState().refreshSessionTree(conversationSessionId(id))
    } catch (err) {
      handleStoreError(err, 'refresh conversation', (error) => set({ error }))
    }
  },

  upsertConversation(conversation: Conversation) {
    set((state) => {
      const conversationById = new Map(state.conversationById)
      conversationById.set(conversation.id, conversation)
      return {
        conversationById,
        conversations: mergeSummary(state.conversations, toSummary(conversation)),
        activeConversation:
          state.activeConversationId === conversation.id ? conversation : state.activeConversation,
        error: null,
      }
    })
  },

  async deleteConversation(id: ConversationId) {
    const previousConversations = get().conversations
    const previousConversationById = get().conversationById
    const previousActiveConversationId = get().activeConversationId
    const previousActiveConversation = get().activeConversation

    set((state) => {
      const conversationById = new Map(state.conversationById)
      conversationById.delete(id)
      return {
        conversationById,
        conversations: removeSummary(state.conversations, id),
        ...(state.activeConversationId === id
          ? { activeConversationId: null, activeConversation: null }
          : {}),
      }
    })

    try {
      await api.deleteConversation(id)
      useComposerStore.getState().clearScopedDraftsForSession(String(id))
      void useSessionStore
        .getState()
        .refreshSessionsAndTree(optionalConversationSessionId(get().activeConversationId))
    } catch (err) {
      set({
        conversations: previousConversations,
        conversationById: previousConversationById,
        activeConversationId: previousActiveConversationId,
        activeConversation: previousActiveConversation,
      })
      handleStoreError(err, 'delete conversation', (error) => set({ error }))
    }
  },

  updateConversationTitle(id: ConversationId, title: string) {
    set((state) => {
      const existing = state.conversationById.get(id)
      if (!existing) {
        const now = Date.now()
        const fallbackSummary: ConversationSummary = {
          id,
          title,
          projectPath: null,
          messageCount: 1,
          createdAt: now,
          updatedAt: now,
        }
        return {
          conversations: mergeSummary(state.conversations, fallbackSummary),
        }
      }

      const conversation = { ...existing, title }
      const conversationById = new Map(state.conversationById)
      conversationById.set(id, conversation)
      return {
        conversationById,
        conversations: mergeSummary(state.conversations, toSummary(conversation)),
        activeConversation:
          state.activeConversationId === id ? conversation : state.activeConversation,
      }
    })
    void useSessionStore.getState().refreshSessionsAndTree(conversationSessionId(id))
  },

  clearError() {
    set({ error: null })
  },
}))
