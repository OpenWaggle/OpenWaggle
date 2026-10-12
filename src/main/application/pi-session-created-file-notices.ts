import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { PiSessionDiscoveryRepository } from '../ports/pi-session-discovery'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { hasAnyActiveRun } from './active-session-runs'
import { deletedPiSessionFile } from './pi-session-deleted-files'

const logger = createLogger('pi-session-created-file-notices')

/** Created Sessions announced with a Pi file that cannot be used, until it is back. */
const announcedSessions = new Set<string>()

/**
 * Announces each Session OpenWaggle created whose Pi file was deleted or went out of reach, once,
 * and again once it is back, so an open view reads it again and shows its notice, or drops it, as
 * a discovered Session's view does. Such a Session stays: its next message starts over.
 */
export function announceCreatedSessionsWithMissingPiFiles() {
  return Effect.gen(function* () {
    const repository = yield* PiSessionDiscoveryRepository
    for (const { sessionId } of yield* repository.listCreatedPiSessionFiles()) {
      if (hasAnyActiveRun(sessionId)) continue
      const missing = (yield* deletedPiSessionFile(sessionId)) !== undefined
      if (missing === announcedSessions.has(sessionId)) continue
      if (missing) announcedSessions.add(sessionId)
      else announcedSessions.delete(sessionId)
      publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
    }
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.warn('Could not look for created Sessions whose Pi session files are missing', {
          cause: Cause.pretty(cause),
        })
      }),
    ),
  )
}
