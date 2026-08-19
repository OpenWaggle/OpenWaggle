import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { TERMINAL_STATUSES } from '@shared/types/session-status'
import { useMemo } from 'react'
import { useSessionStatusStore } from '@/features/sessions/state'
import {
  buildProjectRollUp,
  buildSidebarStateCounts,
  resolveSidebarRowState,
  type SidebarRowState,
  sessionHasInterruptedRun,
} from '../lib/sidebar-row-state'

/**
 * Resolve the state every listed session reports, once.
 *
 * Chips, project roll-ups and rows must agree: a chip saying "Error 1" while no row shows an
 * error is worse than showing neither. Resolving in one place and passing the map down is
 * what makes disagreement impossible.
 */
export function useSidebarRowStates(sessions: readonly SessionSummary[]) {
  const statuses = useSessionStatusStore((s) => s.statuses)
  const completedAt = useSessionStatusStore((s) => s.completedAt)
  const lastVisitedAt = useSessionStatusStore((s) => s.lastVisitedAt)

  return useMemo(() => {
    const byId = new Map<string, SidebarRowState>()

    for (const session of sessions) {
      const id = SessionId(String(session.id))
      const status = statuses.get(id) ?? 'idle'
      // A finished run the user already saw reads as idle, so "Done" keeps meaning news.
      const completed = completedAt.get(id)
      const visited = lastVisitedAt.get(id)
      const isSeen =
        TERMINAL_STATUSES.has(status) &&
        completed !== undefined &&
        visited !== undefined &&
        completed <= visited

      byId.set(
        String(session.id),
        resolveSidebarRowState({
          status: isSeen ? 'idle' : status,
          hasInterruptedRun: sessionHasInterruptedRun(session),
        }),
      )
    }

    const stateOf = (session: SessionSummary) => byId.get(String(session.id)) ?? 'idle'

    return {
      stateOf,
      chipCounts: buildSidebarStateCounts(sessions, stateOf),
      rollUpFor: (projectSessions: readonly SessionSummary[]) =>
        buildProjectRollUp(projectSessions, stateOf),
    }
  }, [sessions, statuses, completedAt, lastVisitedAt])
}
