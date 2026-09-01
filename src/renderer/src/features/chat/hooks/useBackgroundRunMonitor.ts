import { useEffect, useLayoutEffect } from 'react'
import { isTerminalTransportEvent } from '@/features/chat/lib/agent-stream-utils'
import { useAgentLoopEventStore } from '@/features/chat/state/agent-loop-event-store'
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
  const applyAgentLoopEvent = useAgentLoopEventStore((s) => s.applyEvent)
  const addActiveRun = useBackgroundRunStore((s) => s.addActiveRun)
  const applyRunRenderEvent = useBackgroundRunStore((s) => s.applyRunRenderEvent)
  const clearRunRenderSnapshot = useBackgroundRunStore((s) => s.clearRunRenderSnapshot)
  const hasActiveRun = useBackgroundRunStore((s) => s.hasActiveRun)
  const removeActiveRun = useBackgroundRunStore((s) => s.removeActiveRun)
  const initialize = useBackgroundRunStore((s) => s.initialize)
  const refreshSession = useChatStore((s) => s.refreshSession)

  useEffect(() => {
    void initialize()
  }, [initialize])

  // Track stream lifecycle globally
  useLayoutEffect(() => {
    const compactionOnlySessionIds = new Set<string>()
    const unsubEvent = api.onAgentEvent((payload) => {
      applyAgentLoopEvent(payload.sessionId, payload.event)
      if (payload.event.type === 'agent_start') {
        compactionOnlySessionIds.delete(payload.sessionId)
        addActiveRun(payload.sessionId)
      }
      if (payload.event.type === 'compaction_start' && !hasActiveRun(payload.sessionId)) {
        if (payload.event.reason === 'manual') {
          compactionOnlySessionIds.add(payload.sessionId)
        }
        addActiveRun(payload.sessionId)
      }
      applyRunRenderEvent(payload.sessionId, payload.event)
      if (
        payload.event.type === 'compaction_end' &&
        compactionOnlySessionIds.delete(payload.sessionId)
      ) {
        removeActiveRun(payload.sessionId)
      }
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
  }, [
    addActiveRun,
    applyAgentLoopEvent,
    applyRunRenderEvent,
    clearRunRenderSnapshot,
    hasActiveRun,
    refreshSession,
    removeActiveRun,
  ])
}
