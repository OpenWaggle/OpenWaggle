import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { useEffect, useMemo } from 'react'
import { useSessionStatusStore } from '@/features/sessions/state'
import {
  resolveSidebarRowState,
  resolveVisibleSessionStatus,
  type SidebarRowState,
  sessionHasInterruptedRun,
} from '../lib/sidebar-row-state'
import {
  type HydratedTerminalIds,
  pruneHydratedTerminalIds,
} from './remote-sidebar-terminal-status'

/**
 * The state each row shows, including Host-listed Sessions the sidebar has not loaded. The shared
 * map resolves those from their status alone, so a parent reading Done below (ADR 0063) would look
 * quiet there. A remote summary carries its lineage, so it is resolved by the same rule a row uses.
 */
export function useRemoteSidebarRowStates(input: {
  /** Host-discovered terminal rows, pruned here once they no longer hold their state. */
  readonly hydratedTerminalIds: HydratedTerminalIds
  readonly stateBySessionId: ReadonlyMap<string, SidebarRowState>
  readonly loadedSessions: readonly SessionSummary[]
  readonly remoteSessions: readonly SessionSummary[]
}) {
  const statuses = useSessionStatusStore((s) => s.statuses)
  const completedAt = useSessionStatusStore((s) => s.completedAt)
  const lastVisitedAt = useSessionStatusStore((s) => s.lastVisitedAt)
  const { stateBySessionId, loadedSessions, remoteSessions } = input

  const states = useMemo(() => {
    const loaded = new Set(loadedSessions.map((session) => String(session.id)))
    const parents = remoteSessions.filter(
      (session) => session.lineage !== undefined && !loaded.has(String(session.id)),
    )
    if (parents.length === 0) return stateBySessionId
    const states = new Map(stateBySessionId)
    for (const session of parents) {
      const id = SessionId(String(session.id))
      const status = resolveVisibleSessionStatus({
        status: statuses.get(id) ?? 'idle',
        completedAt: completedAt.get(id),
        lastVisitedAt: lastVisitedAt.get(id),
        lineage: session.lineage,
      })
      states.set(
        String(session.id),
        resolveSidebarRowState({ status, hasInterruptedRun: sessionHasInterruptedRun(session) }),
      )
    }
    return states
  }, [stateBySessionId, loadedSessions, remoteSessions, statuses, completedAt, lastVisitedAt])
  usePruneHydratedTerminalIds({ ...input, stateBySessionId: states })
  return states
}

/**
 * Forgets Host-discovered terminal rows once they no longer hold their state. The ids are live (a
 * ref a page load fills), so the raw statuses are read live too; the shown states come from the
 * render, and only loaded and Host-listed rows are resolved with their lineage there, so any other
 * id was loaded after that render and is left alone.
 */
function usePruneHydratedTerminalIds(input: {
  readonly hydratedTerminalIds: HydratedTerminalIds
  readonly stateBySessionId: ReadonlyMap<string, SidebarRowState>
  readonly loadedSessions: readonly SessionSummary[]
  readonly remoteSessions: readonly SessionSummary[]
}) {
  const { hydratedTerminalIds, stateBySessionId, loadedSessions, remoteSessions } = input
  // The shown states change with every raw status change, so they alone say when to run.
  useEffect(() => {
    const resolvedIds = new Set(
      [...loadedSessions, ...remoteSessions].map((session) => String(session.id)),
    )
    pruneHydratedTerminalIds(
      hydratedTerminalIds,
      useSessionStatusStore.getState().statuses,
      stateBySessionId,
      resolvedIds,
    )
  }, [hydratedTerminalIds, stateBySessionId, loadedSessions, remoteSessions])
}
