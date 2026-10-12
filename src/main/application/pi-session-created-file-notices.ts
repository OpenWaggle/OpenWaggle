import type { SessionId } from '@shared/types/brand'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { PiSessionDiscoveryRepository, PiSessionFiles } from '../ports/pi-session-discovery'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { hasAnyActiveRun } from './active-session-runs'
import { deletedPiSessionFile } from './pi-session-deleted-files'

const logger = createLogger('pi-session-created-file-notices')

/**
 * Created Sessions announced with a Pi file that cannot be used, with the notice they were
 * announced with (why the file cannot be used), until it is back.
 */
const announcedNotices = new Map<string, string>()

/** A Session deleted or archived since it was announced is not announced again on its own. */
function forgetUnlistedSessions(listed: ReadonlySet<string>) {
  for (const sessionId of announcedNotices.keys()) {
    if (!listed.has(sessionId)) announcedNotices.delete(sessionId)
  }
}

/** The notice a Session whose Pi file is missing shows, undefined when it shows none. */
function missingFileNotice(sessionId: SessionId) {
  return deletedPiSessionFile(sessionId).pipe(
    Effect.map((missing) => (missing ? (missing.unavailable ?? 'deleted') : undefined)),
  )
}

/**
 * Announces each Session OpenWaggle created whose Pi file was deleted or went out of reach, once,
 * and again once it is back, so an open view reads it again and shows its notice, or drops it, as
 * a discovered Session's view does. Such a Session stays: its next message starts over.
 */
export function announceCreatedSessionsWithMissingPiFiles() {
  return Effect.gen(function* () {
    const repository = yield* PiSessionDiscoveryRepository
    const files = yield* PiSessionFiles
    const listed = yield* repository.listCreatedPiSessionFiles()
    for (const { sessionId, piSessionFile } of listed) {
      if (hasAnyActiveRun(sessionId)) continue
      // Only the file is looked at first; the Session is read only when the file is gone.
      const present =
        !(yield* files.isDeleted(piSessionFile)) &&
        (yield* files.unavailability(piSessionFile)) === undefined
      const announced = announcedNotices.get(sessionId)
      if (present && announced === undefined) continue
      // A missing file's notice may change while it stays missing, as a copy appears or goes,
      // so those few Sessions are read on each pass.
      const notice = present ? undefined : yield* missingFileNotice(sessionId)
      if (notice === announced) continue
      if (notice === undefined) announcedNotices.delete(sessionId)
      else announcedNotices.set(sessionId, notice)
      publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
    }
    forgetUnlistedSessions(new Set(listed.map(({ sessionId }) => String(sessionId))))
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
