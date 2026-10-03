import type { SessionId } from '@shared/types/brand'
import { create } from 'zustand'

/** How many Run ids per Session are remembered as already started or settled. */
const REMEMBERED_RUNS_PER_SESSION = 8

/**
 * Sessions where a queue action (Resume, Send as me, saving or ending an edit, dismissing the
 * blocking message) started a Run that has not reported `agent_start` yet. The Host owns that Run
 * from the moment it answers `started-run`, so the Session's settings must stay locked across the
 * gap before the Run's own events arrive.
 */
interface QueuedRunStartState {
  readonly runIdBySessionId: ReadonlyMap<SessionId, string>
  /*
   * A Run's `agent_start` can reach this window before the Host's answer to the action that
   * started it. Marking it after that would hold the lock until the Session's next settlement, so
   * a Run that already reported in is never marked again.
   */
  readonly reportedRunIds: ReadonlyMap<SessionId, readonly string[]>
  /** Marks the Session as starting `runId`, unless that Run already reported in. */
  readonly mark: (sessionId: SessionId, runId: string) => void
  /** The Session's Run reported in (it started or settled), so nothing waits on it any more. */
  readonly settle: (sessionId: SessionId, runId: string | undefined) => void
  /**
   * The Host reports the Session idle, so the marked `runId` already settled even if its events
   * never reached this window. Drops the mark only if it is still for that Run.
   */
  readonly settleIdle: (sessionId: SessionId, runId: string) => void
}

function withReported(
  reported: ReadonlyMap<SessionId, readonly string[]>,
  sessionId: SessionId,
  runId: string | undefined,
) {
  const runs = reported.get(sessionId) ?? []
  if (!runId || runs.includes(runId)) return reported
  return new Map(reported).set(sessionId, [...runs, runId].slice(-REMEMBERED_RUNS_PER_SESSION))
}

export const useQueuedRunStartStore = create<QueuedRunStartState>((set) => ({
  runIdBySessionId: new Map(),
  reportedRunIds: new Map(),
  mark: (sessionId, runId) =>
    set((state) => {
      if (state.reportedRunIds.get(sessionId)?.includes(runId)) return state
      return { runIdBySessionId: new Map(state.runIdBySessionId).set(sessionId, runId) }
    }),
  settle: (sessionId, runId) =>
    set((state) => {
      const reportedRunIds = withReported(state.reportedRunIds, sessionId, runId)
      if (!state.runIdBySessionId.has(sessionId)) {
        return reportedRunIds === state.reportedRunIds ? state : { reportedRunIds }
      }
      const runIdBySessionId = new Map(state.runIdBySessionId)
      runIdBySessionId.delete(sessionId)
      return { runIdBySessionId, reportedRunIds }
    }),
  settleIdle: (sessionId, runId) =>
    set((state) => {
      if (state.runIdBySessionId.get(sessionId) !== runId) return state
      const runIdBySessionId = new Map(state.runIdBySessionId)
      runIdBySessionId.delete(sessionId)
      return {
        runIdBySessionId,
        reportedRunIds: withReported(state.reportedRunIds, sessionId, runId),
      }
    }),
}))

/** Whether a queue action started a Run in the Session that has not reported `agent_start` yet. */
export function useIsQueuedRunStarting(sessionId: SessionId | null) {
  return useQueuedRunStartStore((state) =>
    sessionId ? state.runIdBySessionId.has(sessionId) : false,
  )
}
