import { useEffect } from 'react'
import { api } from '@/lib/ipc'
import { useChatStore } from '@/stores/chat-store'

/**
 * Sets up the agent event listener and provides chat state + actions.
 * Call once at the app root.
 */
export function useChatSetup(): void {
  const handleAgentEvent = useChatStore((s) => s.handleAgentEvent)

  useEffect(() => {
    const unsub = api.onAgentEvent(handleAgentEvent)
    return unsub
  }, [handleAgentEvent])
}

/**
 * Hook for chat UI — provides messages, status, and actions.
 */
export function useChat() {
  const store = useChatStore()

  return {
    conversations: store.conversations,
    activeConversation: store.activeConversation,
    activeConversationId: store.activeConversationId,
    status: store.status,
    streamingText: store.streamingText,
    streamingParts: store.streamingParts,
    sendMessage: store.sendMessage,
    cancelAgent: store.cancelAgent,
    createConversation: store.createConversation,
    setActiveConversation: store.setActiveConversation,
    deleteConversation: store.deleteConversation,
    loadConversations: store.loadConversations,
  }
}
