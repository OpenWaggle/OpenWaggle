import type { ConversationId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import { useChatStore } from '@/stores/chat-store'

interface ChatReturn {
  conversations: ConversationSummary[]
  activeConversation: Conversation | null
  activeConversationId: ConversationId | null
  createConversation: (projectPath: string) => Promise<ConversationId>
  startDraftSession: () => void
  setActiveConversation: (id: ConversationId | null) => void
  refreshConversation: (id: ConversationId) => Promise<void>
  deleteConversation: (id: ConversationId) => Promise<void>
  updateConversationTitle: (id: ConversationId, title: string) => void
  loadConversations: () => Promise<void>
}

/**
 * Renderer read model for conversation navigation.
 *
 * Session switching must be synchronous: the sidebar click only changes the
 * active ID and reads the full conversation from the local store. Persistence
 * still belongs to main; this store is the renderer-side snapshot/cache.
 */
export function useChat(): ChatReturn {
  const conversations = useChatStore((s) => s.conversations)
  const activeConversation = useChatStore((s) => s.activeConversation)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const createConversation = useChatStore((s) => s.createConversation)
  const startDraftSession = useChatStore((s) => s.startDraftSession)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)
  const refreshConversation = useChatStore((s) => s.refreshConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const updateConversationTitle = useChatStore((s) => s.updateConversationTitle)
  const loadConversations = useChatStore((s) => s.loadConversations)

  return {
    conversations,
    activeConversation,
    activeConversationId,
    createConversation,
    startDraftSession,
    setActiveConversation,
    refreshConversation,
    deleteConversation,
    updateConversationTitle,
    loadConversations,
  }
}
