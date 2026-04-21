import type { ConversationId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/ipc'
import { conversationQueryOptions, conversationsQueryOptions } from '@/queries/conversations'
import { queryKeys } from '@/queries/query-keys'
import { useChatStore } from '@/stores/chat-store'

interface ChatReturn {
  conversations: ConversationSummary[]
  activeConversation: Conversation | null
  activeConversationId: ConversationId | null
  createConversation: (projectPath: string | null) => Promise<ConversationId>
  startDraftThread: () => void
  setActiveConversation: (id: ConversationId | null) => void
  deleteConversation: (id: ConversationId) => Promise<void>
  updateConversationTitle: (id: ConversationId, title: string) => void
  updateConversationProjectPath: (id: ConversationId, projectPath: string | null) => Promise<void>
  loadConversations: () => Promise<void>
}

/**
 * Hook for conversation management — list, create, switch, delete.
 *
 * Conversation data is now fetched and cached by TanStack Query.
 * Thread switching is synchronous when the conversation is in cache:
 * `setActiveConversation(id)` sets the ID in Zustand, and Query returns
 * the cached conversation data immediately on the next render.
 */
export function useChat(): ChatReturn {
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const createConversation = useChatStore((s) => s.createConversation)
  const startDraftThread = useChatStore((s) => s.startDraftThread)
  const setActiveConversationId = useChatStore((s) => s.setActiveConversationId)

  const queryClient = useQueryClient()

  const conversationsQuery = useQuery(conversationsQueryOptions())
  const conversationQuery = useQuery(conversationQueryOptions(activeConversationId))

  const conversations = conversationsQuery.data ?? []
  const activeConversation = conversationQuery.data ?? null

  function setActiveConversation(id: ConversationId | null): void {
    setActiveConversationId(id)
  }

  async function deleteConversation(id: ConversationId): Promise<void> {
    // Optimistic update
    queryClient.setQueryData<ConversationSummary[]>(queryKeys.conversations, (old) =>
      old ? old.filter((c) => c.id !== id) : [],
    )
    if (activeConversationId === id) {
      setActiveConversationId(null)
    }
    try {
      await api.deleteConversation(id)
    } catch {
      // Rollback — refetch
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
    }
  }

  function updateConversationTitle(id: ConversationId, title: string): void {
    // Update conversations list cache
    queryClient.setQueryData<ConversationSummary[]>(queryKeys.conversations, (old) => {
      if (!old) return old
      const idx = old.findIndex((c) => c.id === id)
      if (idx !== -1) {
        const updated = [...old]
        updated[idx] = { ...old[idx], title }
        return updated
      }
      // Conversation was just created (not yet in sidebar). Add it now.
      const conv = queryClient.getQueryData<Conversation>(queryKeys.conversation(id))
      const now = Date.now()
      const summary: ConversationSummary = {
        id,
        title,
        projectPath: conv?.projectPath ?? null,
        messageCount: 1,
        createdAt: conv?.createdAt ?? now,
        updatedAt: now,
      }
      return [summary, ...old]
    })

    // Update individual conversation cache
    queryClient.setQueryData<Conversation>(queryKeys.conversation(id), (old) =>
      old ? { ...old, title } : old,
    )
  }

  async function updateConversationProjectPath(
    id: ConversationId,
    projectPath: string | null,
  ): Promise<void> {
    const updated = await api.updateConversationProjectPath(id, projectPath)
    if (updated && activeConversationId === id) {
      queryClient.setQueryData<Conversation>(queryKeys.conversation(id), updated)
    }
    // Update list cache
    queryClient.setQueryData<ConversationSummary[]>(queryKeys.conversations, (old) => {
      if (!old) return old
      const idx = old.findIndex((c) => c.id === id)
      if (idx === -1) return old
      const updatedList = [...old]
      updatedList[idx] = { ...old[idx], projectPath }
      return updatedList
    })
  }

  async function loadConversations(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
  }

  return {
    conversations,
    activeConversation,
    activeConversationId,
    createConversation,
    startDraftThread,
    setActiveConversation,
    deleteConversation,
    updateConversationTitle,
    updateConversationProjectPath,
    loadConversations,
  }
}
