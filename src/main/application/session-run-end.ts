import type { SessionId } from '@shared/types/brand'
import { activeRuns, activeWaggleRuns } from './active-session-runs'
import { activeSessionWriters } from './session-writer-reservations'

/** The settlements of the live work of `sessionId` that belongs to Run `runId`. */
function runSettlements(sessionId: SessionId, runId: string) {
  const settlements: Promise<void>[] = []
  const writer = activeSessionWriters.get(sessionId)
  if (writer?.runId === runId && !writer.released) settlements.push(writer.settled)
  for (const registry of [activeRuns, activeWaggleRuns]) {
    const entry = registry.get(sessionId)
    if (entry?.metadata.runId === runId) settlements.push(entry.settled)
  }
  return settlements
}

/** Whether Run `runId` of `sessionId` still holds the Session's writer or its Run registration. */
export function isSessionRunLive(sessionId: SessionId, runId: string) {
  return runSettlements(sessionId, runId).length > 0
}

/**
 * Resolves once Run `runId` of `sessionId` has released its writer and Run registration, which
 * its coordinator does after the Run's terminal state is saved. Unlike `waitForSessionRuns`, it
 * neither cancels nor waits for any other Run of the Session, and it has no deadline: the Run
 * ends on its own. Only the current registry slots are read: a Session starts no Run until the
 * previous one has settled (`assertSessionRunStartAllowed`), so a Run that moved to settling has
 * ended for this purpose.
 */
export async function waitForSessionRunEnd(sessionId: SessionId, runId: string) {
  while (true) {
    const settlements = runSettlements(sessionId, runId)
    if (settlements.length === 0) return
    await Promise.all(settlements)
  }
}
