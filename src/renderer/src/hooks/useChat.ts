import type { ConversationId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import { useChatStore } from '@/stores/chat-store'

interface ChatReturn {
  conversations: ConversationSummary[]
  activeConversation: Conversation | null
  activeConversationId: ConversationId | null
  createConversation: (projectPath: string | null) => Promise<ConversationId>
  startDraftThread: () => void
  setActiveConversation: (id: ConversationId | null) => void
  refreshConversation: (id: ConversationId) => Promise<void>
  deleteConversation: (id: ConversationId) => Promise<void>
  updateConversationTitle: (id: ConversationId, title: string) => void
  updateConversationProjectPath: (id: ConversationId, projectPath: string | null) => Promise<void>
  updateConversationPlanMode: (id: ConversationId, active: boolean) => Promise<void>
  loadConversations: () => Promise<void>
}

/**
 * Renderer read model for conversation navigation.
 *
 * Thread switching must be synchronous: the sidebar click only changes the
 * active ID and reads the full conversation from the local store. Persistence
 * still belongs to main; this store is the renderer-side snapshot/cache.
 */
export function useChat(): ChatReturn {
  const conversations = useChatStore((s) => s.conversations)
  const activeConversation = useChatStore((s) => s.activeConversation)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const createConversation = useChatStore((s) => s.createConversation)
  const startDraftThread = useChatStore((s) => s.startDraftThread)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)
  const refreshConversation = useChatStore((s) => s.refreshConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const updateConversationTitle = useChatStore((s) => s.updateConversationTitle)
  const updateConversationProjectPath = useChatStore((s) => s.updateConversationProjectPath)
  const updateConversationPlanMode = useChatStore((s) => s.updateConversationPlanMode)
  const loadConversations = useChatStore((s) => s.loadConversations)

  return {
    conversations,
    activeConversation,
    activeConversationId,
    createConversation,
    startDraftThread,
    setActiveConversation,
    refreshConversation,
    deleteConversation,
    updateConversationTitle,
    updateConversationProjectPath,
    updateConversationPlanMode,
    loadConversations,
  }
}
