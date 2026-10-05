import { SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { useEffect, useLayoutEffect } from 'react'
import { isTerminalTransportEvent } from '@/features/chat/lib/agent-stream-utils'
import { useAgentLoopEventStore } from '@/features/chat/state/agent-loop-event-store'
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store'
import { useChatStore } from '@/features/chat/state/chat-store'
import { useFirstSendPendingStore } from '@/features/chat/state/first-send-pending-store'
import { useOptimisticSteerStore } from '@/features/chat/state/optimistic-steer-store'
import { useQueuedRunStartStore } from '@/features/chat/state/queued-run-start-store'
import { trackRunFinishing, useRunFinishingStore } from '@/features/chat/state/run-finishing-store'
import { api } from '@/shared/lib/ipc'

/**
 * An attempt that Pi will auto-retry ends with `agent_end` + `willRetry`, but the Run continues on
 * the model it started with; forgetting it would hide the pending model-switch notice and move the
 * context meter during the retry wait.
 */
function isRetryingAttemptEnd(event: AgentTransportEvent) {
  return event.type === 'agent_end' && event.willRetry === true
}

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
  const clearSettledRunRenderSnapshot = useBackgroundRunStore(
    (s) => s.clearSettledRunRenderSnapshot,
  )
  const hasActiveRun = useBackgroundRunStore((s) => s.hasActiveRun)
  const noteRunRenderSnapshotRunSettled = useBackgroundRunStore(
    (s) => s.noteRunRenderSnapshotRunSettled,
  )
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
      trackRunFinishing(payload.sessionId, payload.event)
      if (payload.event.type === 'agent_start') {
        compactionOnlySessionIds.delete(payload.sessionId)
        useFirstSendPendingStore.getState().clear(payload.sessionId)
        useQueuedRunStartStore.getState().settle(payload.sessionId, payload.event.runId)
        const runModel = payload.event.model?.trim()
        addActiveRun(payload.sessionId, runModel ? SupportedModelId(runModel) : undefined)
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
      if (isTerminalTransportEvent(payload.event) && !isRetryingAttemptEnd(payload.event)) {
        useFirstSendPendingStore.getState().clear(payload.sessionId)
        useQueuedRunStartStore
          .getState()
          .settle(
            payload.sessionId,
            payload.event.type === 'agent_end' ? payload.event.runId : undefined,
          )
        removeActiveRun(payload.sessionId)
      }
      // A stopped retry delay ends the Run without another agent_end; it finishes until it settles.
      if (payload.event.type === 'auto_retry_end' && !payload.event.success) {
        useFirstSendPendingStore.getState().clear(payload.sessionId)
        useQueuedRunStartStore.getState().settle(payload.sessionId, undefined)
        removeActiveRun(payload.sessionId)
      }
    })

    const unsubCompleted = api.onRunCompleted((payload) => {
      useQueuedRunStartStore.getState().settle(payload.sessionId, payload.runId)
      // A promoted steer the Run never incorporated went back to the queue; one it did shows as
      // its own row. Its preview goes even when no route shows the Session to see it go idle.
      useOptimisticSteerStore.getState().clearSession(payload.sessionId)
      // The snapshot holds the settled Run now; the next Run's start must not keep its answers.
      noteRunRenderSnapshotRunSettled(payload.sessionId, payload.runId)
      // The Session went straight on to a queued Follow-up; it is still running.
      if (payload.continues) return
      useRunFinishingStore.getState().clear(payload.sessionId)
      useFirstSendPendingStore.getState().clear(payload.sessionId)
      removeActiveRun(payload.sessionId)
      void refreshSession(payload.sessionId).finally(() => {
        clearSettledRunRenderSnapshot(payload.sessionId)
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
    clearSettledRunRenderSnapshot,
    hasActiveRun,
    noteRunRenderSnapshotRunSettled,
    refreshSession,
    removeActiveRun,
  ])
}
