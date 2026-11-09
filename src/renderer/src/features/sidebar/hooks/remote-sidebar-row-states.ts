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
  readonly stateBySessionId: ReadonlyMap<string, SidebarRowState>
  readonly loadedSessions: readonly SessionSummary[]
  readonly remoteSessions: readonly SessionSummary[]
}) {
  const statuses = useSessionStatusStore((s) => s.statuses)
  const completedAt = useSessionStatusStore((s) => s.completedAt)
  const lastVisitedAt = useSessionStatusStore((s) => s.lastVisitedAt)
  const { stateBySessionId, loadedSessions, remoteSessions } = input

  return useMemo(() => {
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
}

/**
 * Forgets Host-discovered terminal rows once they no longer hold their state. The ids are live (a
 * ref a page load fills), so the raw statuses are read live too; the shown states come from the
 * render, so an id that render has not resolved yet was loaded after it and is left alone.
 */
export function usePruneHydratedTerminalIds(
  hydratedTerminalIds: HydratedTerminalIds,
  stateBySessionId: ReadonlyMap<string, SidebarRowState>,
) {
  // The shown states change with every raw status change, so they alone say when to run.
  useEffect(() => {
    pruneHydratedTerminalIds(
      hydratedTerminalIds,
      useSessionStatusStore.getState().statuses,
      stateBySessionId,
    )
  }, [hydratedTerminalIds, stateBySessionId])
}
