import type { SessionId } from '@shared/types/brand'
import type { TurnDiffFileSummary } from '@shared/types/turn-diff'
import { keyedCoalescedRead } from '@/shared/lib/coalesced-read'
import { api } from '@/shared/lib/ipc'

/**
 * Turn checkpoint reads shared across the views that show them (v1 performance, B5).
 *
 * Opening a Session read its checkpoint list four or five times (the turn reveal, the diff
 * panel, …) and each settled turn's changed files one call per card. Callers asking together now
 * share one list read, and the changed files of every card mounted in the same task are read in
 * one `sessions:turn-diff-files:list` call.
 */

const EMPTY_FILES: readonly TurnDiffFileSummary[] = []

interface PendingTurnFiles {
  readonly turnIds: Set<string>
  readonly waiters: Map<
    string,
    Array<{
      readonly resolve: (files: readonly TurnDiffFileSummary[]) => void
      readonly reject: (error: unknown) => void
    }>
  >
}

const pendingBySession = new Map<string, PendingTurnFiles>()

function flushTurnFiles(sessionId: SessionId) {
  const pending = pendingBySession.get(String(sessionId))
  pendingBySession.delete(String(sessionId))
  if (!pending) return
  const turnIds = [...pending.turnIds]
  api.listTurnDiffFiles(sessionId, turnIds).then(
    (filesByTurnId) => {
      for (const [turnId, waiters] of pending.waiters) {
        for (const waiter of waiters) waiter.resolve(filesByTurnId[turnId] ?? EMPTY_FILES)
      }
    },
    (error: unknown) => {
      for (const waiters of pending.waiters.values()) {
        for (const waiter of waiters) waiter.reject(error)
      }
    },
  )
}

/** One turn's changed files, read together with every other turn asked for in the same task. */
export function readTurnDiffFiles(
  sessionId: SessionId,
  turnId: string,
): Promise<readonly TurnDiffFileSummary[]> {
  return new Promise((resolve, reject) => {
    const key = String(sessionId)
    let pending = pendingBySession.get(key)
    if (!pending) {
      pending = { turnIds: new Set(), waiters: new Map() }
      pendingBySession.set(key, pending)
      queueMicrotask(() => flushTurnFiles(sessionId))
    }
    pending.turnIds.add(turnId)
    const waiters = pending.waiters.get(turnId) ?? []
    waiters.push({ resolve, reject })
    pending.waiters.set(turnId, waiters)
  })
}

/**
 * The Session's turn checkpoints, read once for every view asking in the same task (the turn
 * reveal and the diff panel), and once more for those asking while it is in flight.
 */
export const readTurnCheckpoints = keyedCoalescedRead((sessionId: SessionId) =>
  api.listTurnCheckpoints(sessionId),
)
