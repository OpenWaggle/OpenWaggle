import type { SessionId } from '@shared/types/brand'
import { type SessionStatus, TERMINAL_STATUSES } from '@shared/types/session-status'
import { useEffect } from 'react'
import { isTerminalTransportEvent } from '@/lib/agent-stream-utils'
import { api } from '@/lib/ipc'
import { useChatStore } from '@/stores/chat-store'
import { useSessionStatusStore } from '@/stores/session-status-store'

/** Set of session IDs that are currently in a waggle run. */
const activeWaggleSessions = new Set<SessionId>()

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
    function setStatusWithVisitCheck(sessionId: SessionId, status: SessionStatus): void {
      setStatus(sessionId, status)
      // If the user is currently viewing this session and it's a terminal status, auto-mark visited
      if (TERMINAL_STATUSES.has(status)) {
        const activeId = useChatStore.getState().activeSessionId
        if (sessionId === activeId) {
          markVisited(sessionId)
        }
      }
    }

    const unsubPhase = api.onAgentPhase(({ sessionId, phase }) => {
      if (!phase) return
      // Don't downgrade waggle-running to working
      if (activeWaggleSessions.has(sessionId)) return
      setStatusWithVisitCheck(sessionId, 'working')
    })

    const unsubCompleted = api.onRunCompleted(({ sessionId }) => {
      activeWaggleSessions.delete(sessionId)
      setStatusWithVisitCheck(sessionId, 'completed')
    })

    const unsubWaggleTurn = api.onWaggleTurnEvent(({ sessionId, event }) => {
      if (event.type === 'turn-start') {
        activeWaggleSessions.add(sessionId)
        setStatusWithVisitCheck(sessionId, 'waggle-running')
      }
      // Terminal waggle events transition to 'completed' via onRunCompleted above.
    })

    const unsubEvent = api.onAgentEvent(({ sessionId, event }) => {
      if (event.type === 'agent_start') {
        if (activeWaggleSessions.has(sessionId)) return
        setStatusWithVisitCheck(sessionId, 'connecting')
        return
      }
      if (event.type === 'agent_end' && event.reason === 'error') {
        setStatusWithVisitCheck(sessionId, 'error')
        return
      }
      if (
        (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') ||
        (event.type === 'message_update' &&
          event.assistantMessageEvent.type === 'toolcall_start') ||
        event.type === 'tool_execution_start'
      ) {
        if (activeWaggleSessions.has(sessionId)) return
        setStatusWithVisitCheck(sessionId, 'working')
        return
      }
      if (isTerminalTransportEvent(event)) {
        setStatusWithVisitCheck(sessionId, 'completed')
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
