import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { PiSessionDiscoveryRepository } from '../ports/pi-session-discovery'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { runSessionRemovalHooks } from './session-removal-hooks'

/**
 * A Session the lifecycle created for a file discovery then could not attach: another writer
 * claimed the file meanwhile (a fork or copy whose preparation recorded it after discovery read
 * its scope), the project's removal started, or attaching failed. While it is still unattached and
 * empty it was never shown with a transcript, so it is deleted rather than left as a stray
 * "New session".
 */
export function removeUnadoptedSession(sessionId: SessionId) {
  return Effect.gen(function* () {
    const state = yield* (yield* PiSessionDiscoveryRepository).getProjectionState(sessionId)
    if (!state || state.piEntryNodeIdPrefix || state.projectedPiEntryCount > 0) return
    // As any deletion does: its removal hooks first, then the sidebar drops the Session.
    yield* runSessionRemovalHooks(sessionId)
    yield* (yield* SessionProjectionRepository).delete(sessionId)
    publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'deleted' })
  })
}

/**
 * Removes the Sessions an earlier Host created for discovered files and stopped before attaching,
 * which are still empty. The file may have changed since, so a pass would not replay them: it
 * creates a new Session for the new version, and the old one would stay as a stray
 * "New session". Run when the Host starts, before its first pass.
 */
export function removeUnattachedDiscoveredSessions() {
  return Effect.gen(function* () {
    const repository = yield* PiSessionDiscoveryRepository
    for (const sessionId of yield* repository.listUnattachedDiscoveredSessions()) {
      yield* removeUnadoptedSession(sessionId)
    }
    // No pass runs yet, so no create is in flight.
    yield* repository.forgetDiscoveryCreates()
  })
}
