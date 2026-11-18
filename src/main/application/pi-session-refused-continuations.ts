import type { RunId, SessionId } from '@shared/types/brand'
import type { PiSessionFileSnapshot, PiSessionProjectionState } from '../ports/pi-session-discovery'

/**
 * Pi settings a reader's projection could not apply because a Run held the Session (ADR 0051).
 * They are for that Run only, which applies them before it reads its profile. Any other Run drops
 * them, as does the holding Run settling and a setting the user changes since: applied later,
 * they would replace what the user chose.
 */
interface RefusedContinuation {
  readonly runId: RunId
  readonly state: PiSessionProjectionState
  readonly snapshot: PiSessionFileSnapshot
}

const refusedContinuations = new Map<string, RefusedContinuation>()

/** Keeps a refused continuation for `runId`, the Run that held the Session. */
export function recordRefusedContinuation(sessionId: SessionId, refused: RefusedContinuation) {
  refusedContinuations.set(sessionId, refused)
}

/**
 * The continuation `runId` held off, for it to apply. One another Run held off is dropped.
 */
export function refusedContinuationFor(sessionId: SessionId, runId: RunId) {
  const refused = refusedContinuations.get(sessionId)
  if (!refused) return undefined
  if (refused.runId === runId) return refused
  refusedContinuations.delete(sessionId)
  return undefined
}

/**
 * Drops the Session's refused continuation: that of `runId` when it settles, or any one when the
 * user changes a setting or the Session's settings were applied.
 */
export function forgetRefusedContinuation(sessionId: SessionId, runId?: RunId) {
  if (runId === undefined || refusedContinuations.get(sessionId)?.runId === runId) {
    refusedContinuations.delete(sessionId)
  }
}
