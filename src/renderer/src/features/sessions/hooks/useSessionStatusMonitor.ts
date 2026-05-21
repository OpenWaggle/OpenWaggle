import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import { type SessionStatus, TERMINAL_STATUSES } from '@shared/types/session-status'
import { useEffect } from 'react'
import { isTerminalTransportEvent } from '@/features/chat/lib'
import { useChatStore } from '@/features/chat/state'
import { useSessionStatusStore } from '@/features/sessions/state/session-status-store'
import { api } from '@/shared/lib/ipc'

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
    function setStatusWithVisitCheck(sessionId: SessionId, status: SessionStatus) {
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
      matchBy(event, 'type')
        .with('turn-start', () => {
          activeWaggleSessions.add(sessionId)
          setStatusWithVisitCheck(sessionId, 'waggle-running')
        })
        // Terminal waggle events transition to 'completed' via onRunCompleted above.
        .otherwise(() => undefined)
    })

    const unsubEvent = api.onAgentEvent(({ sessionId, event }) => {
      matchBy(event, 'type')
        .with('agent_start', () => {
          if (!activeWaggleSessions.has(sessionId)) {
            setStatusWithVisitCheck(sessionId, 'connecting')
          }
        })
        .with('agent_end', (value) => {
          if (value.reason === 'error') {
            setStatusWithVisitCheck(sessionId, 'error')
            return
          }
          if (isTerminalTransportEvent(value)) {
            setStatusWithVisitCheck(sessionId, 'completed')
          }
        })
        .with('message_update', (value) => {
          matchBy(value.assistantMessageEvent, 'type')
            .with('text_delta', 'toolcall_start', () => {
              if (!activeWaggleSessions.has(sessionId)) {
                setStatusWithVisitCheck(sessionId, 'working')
              }
            })
            .otherwise(() => undefined)
        })
        .with('tool_execution_start', () => {
          if (!activeWaggleSessions.has(sessionId)) {
            setStatusWithVisitCheck(sessionId, 'working')
          }
        })
        .otherwise((value) => {
          if (isTerminalTransportEvent(value)) {
            setStatusWithVisitCheck(sessionId, 'completed')
          }
        })
    })

    return () => {
      unsubPhase()
      unsubCompleted()
      unsubWaggleTurn()
      unsubEvent()
    }
  }, [setStatus, markVisited])
}
