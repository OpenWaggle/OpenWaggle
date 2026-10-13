import type { SessionSummary } from '@shared/types/session'
import { hiveStateNeedsAttention } from '@/queries/session-hive-contract'
import { isAttentionState, type SidebarRowState } from './sidebar-row-state'

/**
 * Per-Queen count of hidden (unpinned, Spawn-lineage) Workers that need the user, keyed by Hive root (ADR 0051).
 *
 * A Worker counts when its row state needs a person (the vocabulary the status chips use, which
 * covers a parked request) or when its Delegation state puts it in the Hive panel's Needs you
 * group, so the Queen's line never misses a Worker the panel or the rail dot reports. It can
 * report more: a parked request leaves the Delegation state alone, so the rail dot stays dark.
 */
export function workerAttentionByQueen(
  sessions: readonly SessionSummary[],
  stateOf: (session: SessionSummary) => SidebarRowState,
  pinnedSessionIds: ReadonlySet<string>,
) {
  const byQueen = new Map<string, number>()
  for (const session of sessions) {
    if (session.archived === true) continue
    // A pinned Worker is not hidden: its own Pinned row already shows its state.
    if (pinnedSessionIds.has(String(session.id))) continue
    const lineage = session.lineage
    if (lineage?.role !== 'worker') continue
    // Legacy task-runner Workers are not Spawn lineage, so they are not in the Hive panel.
    if (lineage.historical === true) continue
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

/**
 * The Queen whose sidebar row keeps the Hive-home highlight while this Session is open
 * (ADR 0051), or null. Only a Spawn-lineage Worker has one; a legacy task-runner Worker is not
 * in the Hive panel, so its parent is no Hive home.
 */
export function hiveHomeQueenId(session: SessionSummary | undefined): string | null {
  const lineage = session?.lineage
  if (lineage?.role !== 'worker' || lineage.historical === true) return null
  const queenId = lineage.hiveRootSessionId ?? lineage.parentSessionId
  return queenId === undefined ? null : String(queenId)
}
