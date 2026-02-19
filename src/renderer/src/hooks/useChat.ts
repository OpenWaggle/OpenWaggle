import { useChatStore } from '@/stores/chat-store'

/**
 * Hook for conversation management — list, create, switch, delete.
 * Streaming state is handled by useAgentChat (TanStack AI's useChat).
 */
export function useChat() {
  const conversations = useChatStore((s) => s.conversations)
  const activeConversation = useChatStore((s) => s.activeConversation)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const createConversation = useChatStore((s) => s.createConversation)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const updateConversationProjectPath = useChatStore((s) => s.updateConversationProjectPath)
  const loadConversations = useChatStore((s) => s.loadConversations)

  return {
    conversations,
    activeConversation,
    activeConversationId,
    createConversation,
    setActiveConversation,
    deleteConversation,
    updateConversationProjectPath,
    loadConversations,
  }
}
