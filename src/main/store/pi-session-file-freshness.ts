import { statSync } from 'node:fs'
import type { SessionId } from '@shared/types/brand'

/**
 * What this Host knows about the Pi file behind each Session's projection (ADR 0048).
 *
 * Every persisted snapshot advances the Session's revision and records the file's size and
 * modification time, so a later read can tell in one `stat` whether the file changed outside
 * OpenWaggle. The state is in memory: after a Host restart the first check counts the file's
 * entries once instead, which is the authoritative test anyway.
 */

export interface PiSessionFileState {
  readonly size: number
  readonly mtimeMs: number
}

interface FreshnessEntry {
  readonly revision: number
  readonly fingerprint: PiSessionFileState | null
}

const INITIAL_REVISION = 0
const entries = new Map<SessionId, FreshnessEntry>()

export function piProjectionRevision(sessionId: SessionId) {
  return entries.get(sessionId)?.revision ?? INITIAL_REVISION
}

export function piProjectionFingerprint(sessionId: SessionId) {
  return entries.get(sessionId)?.fingerprint ?? null
}

function statPiSessionFile(file: string): PiSessionFileState | null {
  try {
    const stats = statSync(file)
    return { size: stats.size, mtimeMs: stats.mtimeMs }
  } catch {
    // Pi writes a session file only once it has something to keep.
    return null
  }
}

/** A snapshot was persisted from the file in the state `fingerprint` describes. */
export function recordPiProjection(sessionId: SessionId, fingerprint: PiSessionFileState | null) {
  entries.set(sessionId, {
    revision: piProjectionRevision(sessionId) + 1,
    fingerprint,
  })
}

/** A snapshot was persisted from the file as it is now. */
export function recordPiProjectionOfCurrentFile(sessionId: SessionId, file: string | undefined) {
  recordPiProjection(sessionId, file ? statPiSessionFile(file) : null)
}

/** The projection was checked against the file and still matches it; the revision is unchanged. */
export function recordUnchangedPiProjection(
  sessionId: SessionId,
  expectedRevision: number,
  fingerprint: PiSessionFileState,
) {
  if (piProjectionRevision(sessionId) !== expectedRevision) return false
  entries.set(sessionId, { revision: expectedRevision, fingerprint })
  return true
}
