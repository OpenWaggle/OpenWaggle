import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { useMemo } from 'react'
import { useSessionStatusStore } from '@/features/sessions/state'
import {
  buildProjectRollUp,
  buildSidebarStateCountsFromStates,
  resolveSidebarRowState,
  resolveVisibleSessionStatus,
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

    for (const [sessionId, status] of statuses) {
      byId.set(
        String(sessionId),
        resolveSidebarRowState({
          status: resolveVisibleSessionStatus({
            status,
            completedAt: completedAt.get(sessionId),
            lastVisitedAt: lastVisitedAt.get(sessionId),
          }),
          hasInterruptedRun: false,
        }),
      )
    }

    for (const session of sessions) {
      const id = SessionId(String(session.id))
      // The same rule a row itself uses, so a row and its project heading cannot disagree.
      const status = resolveVisibleSessionStatus({
        status: statuses.get(id) ?? 'idle',
        completedAt: completedAt.get(id),
        lastVisitedAt: lastVisitedAt.get(id),
      })

      byId.set(
        String(session.id),
        resolveSidebarRowState({
          status,
          hasInterruptedRun: sessionHasInterruptedRun(session),
        }),
      )
    }

    const stateOf = (session: SessionSummary) => byId.get(String(session.id)) ?? 'idle'

    return {
      stateOf,
      stateBySessionId: byId,
      chipCounts: buildSidebarStateCountsFromStates(byId.values()),
      rollUpFor: (projectSessions: readonly SessionSummary[]) =>
        buildProjectRollUp(projectSessions, stateOf),
    }
  }, [sessions, statuses, completedAt, lastVisitedAt])
}
