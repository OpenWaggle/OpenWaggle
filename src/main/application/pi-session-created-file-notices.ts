import type { SessionId } from '@shared/types/brand'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { PiSessionDiscoveryRepository, PiSessionFiles } from '../ports/pi-session-discovery'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { hasAnyActiveRun } from './active-session-runs'
import { inspectPiSessionFile } from './pi-session-file-inspection'

const logger = createLogger('pi-session-created-file-notices')

/**
 * Created Sessions announced with a Pi file that cannot be used, with the notice they were
 * announced with (why the file cannot be used), until it is back.
 */
const announcedNotices = new Map<string, string>()

/**
 * Created Sessions whose deleted Pi file a Run would replace with a copy, with the file listed for
 * them and the copy: they show no notice while that copy is there, so they are not read again.
 */
const continuedCopies = new Map<string, { readonly listedFile: string; readonly copy: string }>()

/** A Session deleted or archived since it was announced is not announced again on its own. */
function forgetUnlistedSessions(listed: ReadonlySet<string>) {
  for (const sessions of [announcedNotices, continuedCopies]) {
    for (const sessionId of sessions.keys()) {
      if (!listed.has(sessionId)) sessions.delete(sessionId)
    }
  }
}

function isPresent(file: string) {
  return Effect.gen(function* () {
    const files = yield* PiSessionFiles
    return !(yield* files.isDeleted(file)) && (yield* files.unavailability(file)) === undefined
  })
}

/** The notice a Session whose listed Pi file is missing shows, undefined when it shows none. */
function missingFileNotice(sessionId: SessionId, listedFile: string) {
  return Effect.gen(function* () {
    const continued = continuedCopies.get(sessionId)
    if (continued?.listedFile === listedFile && (yield* isPresent(continued.copy))) return undefined
    continuedCopies.delete(sessionId)
    const { missing, continuedCopy } = yield* inspectPiSessionFile(sessionId)
    if (continuedCopy) continuedCopies.set(sessionId, { listedFile, copy: continuedCopy })
    return missing
      ? `${missing.unavailable ?? 'deleted'}:${missing.unreadableFolder ?? ''}`
      : undefined
  })
}

/**
 * Announces each Session OpenWaggle created whose Pi file was deleted or went out of reach, once,
 * and again once it is back, so an open view reads it again and shows its notice, or drops it, as
 * a discovered Session's view does. Such a Session stays: its next message starts over.
 */
export function announceCreatedSessionsWithMissingPiFiles() {
  return Effect.gen(function* () {
    const repository = yield* PiSessionDiscoveryRepository
    const listed = yield* repository.listCreatedPiSessionFiles()
    for (const { sessionId, piSessionFile } of listed) {
      if (hasAnyActiveRun(sessionId)) continue
      // Only the file is looked at first; the Session is read only when the file is gone.
      const present = yield* isPresent(piSessionFile)
      if (present) continuedCopies.delete(sessionId)
      const announced = announcedNotices.get(sessionId)
      if (present && announced === undefined) continue
      // A missing file's notice may change while it stays missing, as a copy appears or goes,
      // so those few Sessions are read on each pass, unless the copy they continue is there.
      const notice = present ? undefined : yield* missingFileNotice(sessionId, piSessionFile)
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
