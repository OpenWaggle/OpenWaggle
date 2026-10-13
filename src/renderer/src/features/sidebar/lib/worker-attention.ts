import type { SessionSummary } from '@shared/types/session'
import { hiveStateNeedsAttention } from '@/queries/session-hive-contract'
import { isAttentionState, type SidebarRowState } from './sidebar-row-state'

/**
 * Per-Queen count of hidden Workers that need the user, keyed by Hive root (ADR 0050).
 *
 * A Worker counts when its row state needs a person (the vocabulary the status chips use, which
 * covers a parked request) or when its Delegation state puts it in the Hive panel's Needs you
 * group, so the Queen's line never misses a Worker the panel or the rail dot reports.
 */
export function workerAttentionByQueen(
  sessions: readonly SessionSummary[],
  stateOf: (session: SessionSummary) => SidebarRowState,
) {
  const byQueen = new Map<string, number>()
  for (const session of sessions) {
    if (session.archived === true) continue
    const lineage = session.lineage
    if (lineage?.role !== 'worker') continue
    const needsUser =
      isAttentionState(stateOf(session)) || hiveStateNeedsAttention(lineage.delegationState)
    if (!needsUser) continue
    const queenId = lineage.hiveRootSessionId ?? lineage.parentSessionId
    if (queenId === undefined) continue
    const key = String(queenId)
    byQueen.set(key, (byQueen.get(key) ?? 0) + 1)
  }
  return byQueen
}
