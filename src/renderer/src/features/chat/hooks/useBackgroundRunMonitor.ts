import { type SessionId, SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { useEffect, useLayoutEffect } from 'react'
import {
  isRunStreamingEvent,
  isTerminalTransportEvent,
} from '@/features/chat/lib/agent-stream-utils'
import { incorporatedUserRow } from '@/features/chat/lib/chat-stream-user-messages'
import { createStartedRuns } from '@/features/chat/lib/run-ids'
import { useAgentLoopEventStore } from '@/features/chat/state/agent-loop-event-store'
import { withUnannouncedRunNotice } from '@/features/chat/state/background-run-active-state'
import { takeRestoredRunId } from '@/features/chat/state/background-run-activity-restore'
import { withUnannouncedRunNamed } from '@/features/chat/state/background-run-started-run'
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store'
import { useChatStore } from '@/features/chat/state/chat-store'
import {
  trackExtensionStatus,
  useExtensionStatusStore,
} from '@/features/chat/state/extension-status-store'
import { useFirstSendPendingStore } from '@/features/chat/state/first-send-pending-store'
import { releaseLiveStreamMessage } from '@/features/chat/state/live-stream-message-store'
import { useOptimisticSteerStore } from '@/features/chat/state/optimistic-steer-store'
import { useQueuedRunStartStore } from '@/features/chat/state/queued-run-start-store'
import { trackRunFinishing, useRunFinishingStore } from '@/features/chat/state/run-finishing-store'
import { subscribeAgentEvents } from '@/shared/lib/agent-event-hub'
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
    // Sessions a compaction made busy without a Run start: a Run streaming there is unannounced.
    const startlessSessionIds = new Set<string>()
    const startless = { compactionOnlySessionIds, startlessSessionIds }
    const startedRuns = createStartedRuns()
    const unsubEvent = subscribeAgentEvents((payload) => {
      applyAgentLoopEvent(payload.sessionId, payload.event)
      trackRunFinishing(payload.sessionId, payload.event)
      trackExtensionStatus(payload.sessionId, payload.event)
      if (payload.event.type === 'agent_start') {
        compactionOnlySessionIds.delete(payload.sessionId)
        startlessSessionIds.delete(payload.sessionId)
        useFirstSendPendingStore.getState().clear(payload.sessionId)
        useQueuedRunStartStore.getState().settle(payload.sessionId, payload.event.runId)
        // Another Run starts: the Host settled the one before (its settlement may reach this
        // renderer later), putting a promoted steer it never took back in the queue.
        const restored = takeRestoredRunId(payload.sessionId)
        if (startedRuns.start(payload.sessionId, payload.event.runId, restored)) {
          useOptimisticSteerStore.getState().clearSession(payload.sessionId)
        }
        useOptimisticSteerStore.getState().noteRunStarted(payload.sessionId, payload.event.runId)
        const runModel = payload.event.model?.trim()
        addActiveRun(payload.sessionId, runModel ? SupportedModelId(runModel) : undefined)
      }
      trackStartedRun(payload.sessionId, payload.event, startless, startedRuns)
      if (payload.event.type === 'compaction_start' && !hasActiveRun(payload.sessionId)) {
        if (payload.event.reason === 'manual') {
          compactionOnlySessionIds.add(payload.sessionId)
        }
        startlessSessionIds.add(payload.sessionId)
        addActiveRun(payload.sessionId)
      }
      applyRunRenderEvent(payload.sessionId, payload.event)
      notePromotedSteerIncorporation(payload.sessionId, payload.event)
      if (
        payload.event.type === 'compaction_end' &&
        compactionOnlySessionIds.delete(payload.sessionId)
      ) {
        startlessSessionIds.delete(payload.sessionId)
        removeActiveRun(payload.sessionId)
      }
      if (isTerminalTransportEvent(payload.event) && !isRetryingAttemptEnd(payload.event)) {
        useFirstSendPendingStore.getState().clear(payload.sessionId)
        const endedRunId = payload.event.type === 'agent_end' ? payload.event.runId : undefined
        useQueuedRunStartStore.getState().settle(payload.sessionId, endedRunId)
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
      releaseLiveStreamMessage(payload.sessionId)
      startlessSessionIds.delete(payload.sessionId)
      // A settled Run's extension statuses go with it, whatever runs next.
      useExtensionStatusStore.getState().clearRun(payload.sessionId, payload.runId)
      useQueuedRunStartStore.getState().settle(payload.sessionId, payload.runId)
      // The snapshot holds the settled Run now; the next Run's start must not keep its answers. A
      // next Run whose start was lost streamed into it: only the rows before it are the settled's.
      noteRunRenderSnapshotRunSettled(
        payload.sessionId,
        payload.runId,
        startedRuns.unannouncedAfter(payload.sessionId, payload.runId),
      )
      // An earlier Run settling after the next one started: the Session is still running it, with
      // its promoted steers and its snapshot; the refetch brings in the settled Run.
      if (
        startedRuns.settle(payload.sessionId, payload.runId, takeRestoredRunId(payload.sessionId))
      ) {
        void refreshSession(payload.sessionId)
        return
      }
      // A promoted steer the Run never incorporated went back to the queue; one it did shows as
      // its own row. Its preview goes even when no route shows the Session to see it go idle.
      useOptimisticSteerStore.getState().clearSession(payload.sessionId)
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

/**
 * Every end of a Run names it when the renderer holds it unnamed or unannounced, a retrying or a
 * tool-use end too: a Run whose start was lost can end without a terminal `agent_end`.
 */
function trackStartedRun(
  sessionId: SessionId,
  event: AgentTransportEvent,
  startless: {
    readonly compactionOnlySessionIds: Set<string>
    readonly startlessSessionIds: Set<string>
  },
  startedRuns: ReturnType<typeof createStartedRuns>,
) {
  if (event.type === 'agent_end') {
    startedRuns.end(sessionId, event.runId)
    return
  }
  // The manual compaction's end no longer ends the Session's activity: a Run is running.
  if (noteStreamingRun(sessionId, event, startless.startlessSessionIds, startedRuns)) {
    startless.compactionOnlySessionIds.delete(sessionId)
  }
}

/**
 * The Run's start never reached this renderer (a resync lost it), yet the Run streams on: it is
 * active, or the chat would show its Session idle, and empty, until the Run settles. A compaction
 * alone made the Session busy before (Pi compacts before a Run starts too); a Run streaming there
 * is a Run. Listed after the Runs started, a late settlement of the one before does not settle it.
 */
function noteStreamingRun(
  sessionId: SessionId,
  event: AgentTransportEvent,
  startlessSessionIds: Set<string>,
  startedRuns: ReturnType<typeof createStartedRuns>,
) {
  if (!isRunStreamingEvent(event)) return false
  const store = useBackgroundRunStore.getState()
  if (store.hasActiveRun(sessionId) && !startlessSessionIds.delete(sessionId)) return false
  startedRuns.noteUnannounced(sessionId, takeRestoredRunId(sessionId))
  void nameUnannouncedRun(sessionId, startedRuns)
  // The Session started: a first send's "Starting session" and the Run before's finishing are
  // over, as at a start.
  useFirstSendPendingStore.getState().clear(sessionId)
  useRunFinishingStore.getState().clear(sessionId)
  const runModel = event.model?.trim()
  store.noteUnannouncedRun(
    sessionId,
    event.timestamp,
    runModel ? SupportedModelId(runModel) : undefined,
  )
  return true
}

/**
 * The Run whose start was lost, named from the Host's buffer, does what its start would have: when
 * it is another Run than the one before, the Host put the steers that Run never took back in the
 * queue, and their previews go; those promoted into this Run (Pi continuing it) stay.
 */
async function nameUnannouncedRun(
  sessionId: SessionId,
  startedRuns: ReturnType<typeof createStartedRuns>,
) {
  const runId = (await api.getBackgroundRun(sessionId).catch(() => null))?.runId
  if (runId === undefined) return
  const anotherRun = startedRuns.name(sessionId, runId)
  if (anotherRun === undefined) return
  // Another Run: the rows set apart now are the Run before's, so a shown chat hydrates again.
  useBackgroundRunStore.setState((state) => ({
    ...withUnannouncedRunNamed(state, sessionId, runId, anotherRun),
    ...(anotherRun ? withUnannouncedRunNotice(state, sessionId) : {}),
  }))
  if (anotherRun) useOptimisticSteerStore.getState().clearSession(sessionId)
  useOptimisticSteerStore.getState().noteRunStarted(sessionId, runId)
}

/**
 * A promoted steer's preview learns when Pi incorporated it from the event itself: the chat may not
 * show the user row it became (a transcript rebuilt from a detail that lacks it), and the preview
 * then stands in for it at that time rather than below the answers after it.
 */
function notePromotedSteerIncorporation(sessionId: SessionId, event: AgentTransportEvent) {
  if (event.type !== 'message_start' || event.role !== 'user' || !event.userMessage) return
  const userMessage = event.userMessage
  useOptimisticSteerStore
    .getState()
    .noteIncorporated(sessionId, incorporatedUserRow({ ...event, userMessage }))
}
