import type { SessionSummary } from '@shared/types/session'
import { hiveMemberNextActor } from '@/queries/session-hive-next-actor'
import type { SidebarRowState } from './sidebar-row-state'

/** What a Queen's sidebar line reports about her hidden Workers (ADR 0059). */
export interface QueenWorkerAttention {
  /** Workers only the person can unblock: "n need you", in the attention colour. */
  readonly needYou: number
  /** Her direct Workers waiting for her: a muted "n waiting for ‹Queen›", no dot. */
  readonly waiting: number
}

export const NO_QUEEN_WORKER_ATTENTION: QueenWorkerAttention = { needYou: 0, waiting: 0 }

/** A hidden Spawn-lineage Worker's Hive root, or null when the Queen's line does not count it. */
function hiddenWorkerQueenId(session: SessionSummary, pinnedSessionIds: ReadonlySet<string>) {
  if (session.archived === true) return null
  // A pinned Worker is not hidden: its own Pinned row already shows its state.
  if (pinnedSessionIds.has(String(session.id))) return null
  const lineage = session.lineage
  // Legacy task-runner Workers are not Spawn lineage, so they are not in the Hive panel.
  if (lineage?.role !== 'worker' || lineage.historical === true) return null
  const queenId = lineage.hiveRootSessionId ?? lineage.parentSessionId
  return queenId === undefined ? null : String(queenId)
}

/**
 * Per-Queen counts of hidden (unpinned, Spawn-lineage) Workers by who acts next, keyed by Hive
 * root (ADR 0051, ADR 0059). The rule is the Hive panel's, so the Queen's line never disagrees
 * with its Needs you group or the rail dot. A Worker's live row state supplies its parked request;
 * a failed Run alone is not the person's to act on unless no agent will pick it up.
 */
export function workerAttentionByQueen(
  sessions: readonly SessionSummary[],
  stateOf: (session: SessionSummary) => SidebarRowState,
  pinnedSessionIds: ReadonlySet<string>,
) {
  const byQueen = new Map<string, QueenWorkerAttention>()
  for (const session of sessions) {
    const queenId = hiddenWorkerQueenId(session, pinnedSessionIds)
    if (queenId === null) continue
    const state = stateOf(session)
    const next = hiveMemberNextActor(session, state === 'interrupted' ? 'idle' : state)
    const needsYou = next?.nextActor === 'user'
    // "Waiting for ‹Queen›" names her, so it counts only the Workers she spawned herself.
    const waitsForQueen =
      next?.nextActor === 'parent' && String(session.lineage?.parentSessionId ?? '') === queenId
    if (!needsYou && !waitsForQueen) continue
    const current = byQueen.get(queenId) ?? NO_QUEEN_WORKER_ATTENTION
    byQueen.set(queenId, {
      needYou: current.needYou + (needsYou ? 1 : 0),
      waiting: current.waiting + (waitsForQueen ? 1 : 0),
    })
  }
  return byQueen
}

export function queenWorkerAttention(
  byQueen: ReadonlyMap<string, QueenWorkerAttention>,
  queenId: string,
): QueenWorkerAttention {
  return byQueen.get(queenId) ?? NO_QUEEN_WORKER_ATTENTION
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
