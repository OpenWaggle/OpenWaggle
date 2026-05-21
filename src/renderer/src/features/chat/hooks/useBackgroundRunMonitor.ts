import { useEffect } from 'react'
import { isTerminalTransportEvent } from '@/features/chat/lib/agent-stream-utils'
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store'
import { useChatStore } from '@/features/chat/state/chat-store'
import { api } from '@/shared/lib/ipc'

/**
 * Mounted once at the workspace level. Tracks which sessions have
 * active background runs by listening to runtime start/end events
 * and the run-completed event. It also keeps a lightweight render snapshot
 * for active runs so route switches do not blank live tool/reasoning rows.
 *
 * When a background run completes, updates only the affected session's
 * metadata in the sidebar (timestamp) instead of reloading the full list.
 */
export function useBackgroundRunMonitor(): void {
  const addActiveRun = useBackgroundRunStore((s) => s.addActiveRun)
  const applyRunRenderEvent = useBackgroundRunStore((s) => s.applyRunRenderEvent)
  const clearRunRenderSnapshot = useBackgroundRunStore((s) => s.clearRunRenderSnapshot)
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
      }
      applyRunRenderEvent(payload.sessionId, payload.event)
      if (isTerminalTransportEvent(payload.event)) {
        removeActiveRun(payload.sessionId)
      }
    })

    const unsubCompleted = api.onRunCompleted((payload) => {
      removeActiveRun(payload.sessionId)
      void refreshSession(payload.sessionId).finally(() => {
        clearRunRenderSnapshot(payload.sessionId)
      })
    })

    return () => {
      unsubEvent()
      unsubCompleted()
    }
  }, [addActiveRun, applyRunRenderEvent, clearRunRenderSnapshot, refreshSession, removeActiveRun])
}
