import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { useMemo } from 'react'
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
 * The state each row shows, including Host-listed Sessions the sidebar has not loaded, and the
 * Host-discovered terminal rows that still hold their state. The shared map resolves unloaded
 * Sessions from their status alone, so a parent reading Done below (ADR 0065) would look quiet
 * there. A remote summary carries its lineage, so it is resolved by the same rule a row uses.
 */
export function useRemoteSidebarRowStates(input: {
  readonly hydratedTerminalIds: HydratedTerminalIds
  /** Stores the pruned ids; called while rendering, only when some id was forgotten. */
  readonly setHydratedTerminalIds: (next: HydratedTerminalIds) => void
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

  // Only loaded and Host-listed rows are resolved with their lineage in this render; an id a page
  // hydrated before its summary reached `remoteSessions` is left to the new-Run rule.
  const resolvedIds = new Set(
    [...loadedSessions, ...remoteSessions].map((session) => String(session.id)),
  )
  const hydratedTerminalIds = pruneHydratedTerminalIds(
    input.hydratedTerminalIds,
    statuses,
    states,
    resolvedIds,
  )
  // Adjusting state while rendering (React's documented pattern): the forgotten ids are gone
  // from this render on, and the next render starts from the pruned state.
  if (hydratedTerminalIds !== input.hydratedTerminalIds) {
    input.setHydratedTerminalIds(hydratedTerminalIds)
  }
  return { stateBySessionId: states, hydratedTerminalIds }
}
