import type { ConversationId } from '@shared/types/brand'
import { type SessionStatus, TERMINAL_STATUSES } from '@shared/types/session-status'
import { useEffect } from 'react'
import { isTerminalTransportEvent } from '@/lib/agent-stream-utils'
import { api } from '@/lib/ipc'
import { useChatStore } from '@/stores/chat-store'
import { useSessionStatusStore } from '@/stores/session-status-store'

/** Set of conversation IDs that are currently in a waggle run. */
const activeWaggleConversations = new Set<ConversationId>()

/**
 * Subscribes to agent lifecycle events and maintains per-session status
 * in the session-status store. Mounted once at workspace level.
 *
 * When a terminal status arrives for the currently active session,
 * it is immediately marked as visited so the icon doesn't flash.
 */
export function useSessionStatusMonitor(): void {
  const setStatus = useSessionStatusStore((s) => s.setStatus)
  const markVisited = useSessionStatusStore((s) => s.markVisited)

  useEffect(() => {
    function setStatusWithVisitCheck(conversationId: ConversationId, status: SessionStatus): void {
      setStatus(conversationId, status)
      // If the user is currently viewing this session and it's a terminal status, auto-mark visited
      if (TERMINAL_STATUSES.has(status)) {
        const activeId = useChatStore.getState().activeConversationId
        if (conversationId === activeId) {
          markVisited(conversationId)
        }
      }
    }

    const unsubPhase = api.onAgentPhase(({ conversationId, phase }) => {
      if (!phase) return
      // Don't downgrade waggle-running to working
      if (activeWaggleConversations.has(conversationId)) return
      setStatusWithVisitCheck(conversationId, 'working')
    })

    const unsubCompleted = api.onRunCompleted(({ conversationId }) => {
      activeWaggleConversations.delete(conversationId)
      setStatusWithVisitCheck(conversationId, 'completed')
    })

    const unsubWaggleTurn = api.onWaggleTurnEvent(({ conversationId, event }) => {
      if (event.type === 'turn-start' || event.type === 'synthesis-start') {
        activeWaggleConversations.add(conversationId)
        setStatusWithVisitCheck(conversationId, 'waggle-running')
      }
      // Terminal waggle events transition to 'completed' via onRunCompleted above.
    })

    const unsubEvent = api.onAgentEvent(({ conversationId, event }) => {
      if (event.type === 'agent_start') {
        if (activeWaggleConversations.has(conversationId)) return
        setStatusWithVisitCheck(conversationId, 'connecting')
        return
      }
      if (event.type === 'agent_end' && event.reason === 'error') {
        setStatusWithVisitCheck(conversationId, 'error')
        return
      }
      if (
        (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') ||
        (event.type === 'message_update' &&
          event.assistantMessageEvent.type === 'toolcall_start') ||
        event.type === 'tool_execution_start'
      ) {
        if (activeWaggleConversations.has(conversationId)) return
        setStatusWithVisitCheck(conversationId, 'working')
        return
      }
      if (isTerminalTransportEvent(event)) {
        setStatusWithVisitCheck(conversationId, 'completed')
      }
    })

    return () => {
      unsubPhase()
      unsubCompleted()
      unsubWaggleTurn()
      unsubEvent()
    }
  }, [setStatus, markVisited])
}
