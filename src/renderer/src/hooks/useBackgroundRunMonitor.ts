import { useEffect } from 'react'
import { isTerminalTransportEvent } from '@/lib/agent-stream-utils'
import { api } from '@/lib/ipc'
import { useBackgroundRunStore } from '@/stores/background-run-store'
import { useChatStore } from '@/stores/chat-store'

/**
 * Mounted once at the workspace level. Tracks which sessions have
 * active background runs by listening to runtime start/end events
 * and the run-completed event. Does NOT track event content — only presence.
 *
 * When a background run completes, updates only the affected session's
 * metadata in the sidebar (timestamp) instead of reloading the full list.
 */
export function useBackgroundRunMonitor(): void {
  const addActiveRun = useBackgroundRunStore((s) => s.addActiveRun)
  const removeActiveRun = useBackgroundRunStore((s) => s.removeActiveRun)
  const initialize = useBackgroundRunStore((s) => s.initialize)
  const refreshSession = useChatStore((s) => s.refreshSession)

  useEffect(() => {
    void initialize()
  }, [initialize])

  // Track stream lifecycle globally
  useEffect(() => {
    const unsubEvent = api.onAgentEvent((payload) => {
      if (payload.event.type === 'agent_start') {
        addActiveRun(payload.sessionId)
        return
      }
      if (isTerminalTransportEvent(payload.event)) {
        removeActiveRun(payload.sessionId)
      }
    })

    const unsubCompleted = api.onRunCompleted((payload) => {
      removeActiveRun(payload.sessionId)
      void refreshSession(payload.sessionId)
    })

    return () => {
      unsubEvent()
      unsubCompleted()
    }
  }, [addActiveRun, refreshSession, removeActiveRun])
}
