import {
  deletedPiSessionFileMessage,
  type PiSessionFileUnavailability,
  unavailablePiSessionFileMessage,
} from '@shared/domain/pi-session-file-messages'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { createLogger } from '../logger'
import { PiSessionDiscoveryRepository, PiSessionFiles } from '../ports/pi-session-discovery'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { hasAnyActiveRun, isSessionRemovalFenced } from './active-session-runs'
import { withSessionDesktopRemoval } from './session-desktop-removal'
import { deleteSessionWithVisualizations } from './session-visualization-deletion'

/**
 * A discovered Session's history is its Pi file (ADR 0051). When something outside OpenWaggle
 * deletes it, as Pi's `/resume` picker can, the Session is gone too: continuing it would start a
 * new file under the same Pi session id, which loses the history in OpenWaggle and brings the
 * deleted session back to `pi --resume`.
 */

const logger = createLogger('pi-session-deleted-files')

/** What a deletion refusal names as depending on the Session, such as `fork <id> still depends on it`. */
function dependency(refusal: string) {
  return /because (.+?)\.?$/.exec(refusal)?.[1] ?? refusal
}

/** What a refusal names, such as `fork <id>`, which a fork or Worker's title names better. */
const DEPENDENT_SESSION = /^(fork|worker) (\S+) still depends on it$/

/**
 * What keeps the Session, with the fork or Worker named by its title, as the sidebar shows it;
 * by its id when it has none.
 */
function namedDependency(refusal: string) {
  const dependsOn = dependency(refusal)
  const named = DEPENDENT_SESSION.exec(dependsOn)
  const [, kind, id] = named ?? []
  if (!kind || !id) return Effect.succeed(dependsOn)
  return Effect.gen(function* () {
    const projections = yield* Effect.serviceOption(SessionProjectionRepository)
    if (Option.isNone(projections)) return dependsOn
    const title = (yield* projections.value
      .getOptional(SessionId(id))
      .pipe(Effect.orElseSucceed(() => null)))?.title.trim()
    return title ? `${kind} "${title}" still depends on it` : dependsOn
  })
}

export class DeletedPiSessionFileError extends Error {
  /** `dependsOn`: what keeps the Session, as `deletionRefusal` says, such as a fork. */
  constructor(piSessionFile: string, dependsOn?: string) {
    const lost = deletedPiSessionFileMessage(piSessionFile)
    super(
      dependsOn
        ? `${lost} Restore the file to continue it. The Session stays, to read, because ${dependsOn}.`
        : `${lost} Restore the file to continue it, or delete the Session.`,
    )
    this.name = 'DeletedPiSessionFileError'
  }
}

/**
 * A Session's Pi file is out of reach: its folder is missing, renamed away or on a drive that is
 * not connected. The Session stays, and its Runs are refused until the folder is back.
 */
export class UnavailablePiSessionFileError extends Error {
  constructor(piSessionFile: string, unavailability: PiSessionFileUnavailability) {
    super(unavailablePiSessionFileMessage(piSessionFile, unavailability))
    this.name = 'UnavailablePiSessionFileError'
  }
}

/** OpenWaggle-created Sessions already warned about a deleted file, by Session and file. */
const warnedDeletedFiles = new Set<string>()

/** Sessions kept because others depend on them, reported once per Host rather than every pass. */
const keptSessions = new Set<string>()

/** A kept Session whose file is back: an open view refetches it, without its notice. */
function forgetKeptSession(sessionId: SessionId) {
  if (!keptSessions.delete(sessionId)) return
  publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
}

/**
 * Removes one Session whose Pi file was deleted, the way deleting it in the sidebar does: its
 * Runs, terminals, preview tabs, project actions, and visualizations go too, under the removal
 * fence. Nothing is dismissed and no copy is deleted (`removingProject`), so a file restored
 * later is discovered again. A Session a fork or Worker depends on cannot be deleted, so it stays,
 * readable, and its Runs are refused.
 */
function removeSessionWithDeletedFile(sessionId: SessionId, piSessionFile: string) {
  return Effect.gen(function* () {
    const refusal = yield* (yield* PiSessionDiscoveryRepository).deletionRefusal(sessionId)
    if (refusal) {
      if (keptSessions.has(sessionId)) return
      keptSessions.add(sessionId)
      // An open view refetches it, and shows why it cannot be continued.
      publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
      logger.info('Kept a Session whose Pi session file was deleted, because others depend on it', {
        sessionId,
        piSessionFile,
        reason: refusal,
      })
      return
    }
    yield* withSessionDesktopRemoval(
      sessionId,
      deleteSessionWithVisualizations(sessionId, { removingProject: true }),
      'delete',
    )
    // The deletion announces the Session as deleted, as a sidebar delete does.
    keptSessions.delete(sessionId)
    logger.info('Removed a Session whose Pi session file was deleted', { sessionId, piSessionFile })
  }).pipe(
    // One Session that cannot be removed never stops the others.
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.warn('Could not remove a Session whose Pi session file was deleted', {
          sessionId,
          piSessionFile,
          cause: Cause.pretty(cause),
        })
      }),
    ),
  )
}

/**
 * Removes each discovered Session whose Pi file was deleted and announces it as deleted. A
 * Session with a Run, or one being removed, is left for a later pass; its Run is refused instead.
 */
export function removeSessionsWithDeletedPiFiles() {
  return Effect.gen(function* () {
    const repository = yield* PiSessionDiscoveryRepository
    const files = yield* PiSessionFiles
    for (const { sessionId, piSessionFile } of yield* repository.listAdoptedPiSessionFiles()) {
      if (hasAnyActiveRun(sessionId) || isSessionRemovalFenced(sessionId)) continue
      if (!(yield* files.isDeleted(piSessionFile))) {
        forgetKeptSession(sessionId)
        continue
      }
      yield* removeSessionWithDeletedFile(sessionId, piSessionFile)
    }
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.warn('Could not look for Sessions whose Pi session files were deleted', {
          cause: Cause.pretty(cause),
        })
      }),
    ),
  )
}

/**
 * The Session's Pi file, when it was deleted outside OpenWaggle or is out of reach, with whether
 * OpenWaggle created the Session. A file a new Session recorded before Pi wrote it (no projected
 * Pi entry yet) was never written, not deleted.
 */
function deletedPiSessionFile(sessionId: SessionId) {
  return Effect.gen(function* () {
    const repository = yield* Effect.serviceOption(PiSessionDiscoveryRepository)
    const files = yield* Effect.serviceOption(PiSessionFiles)
    if (Option.isNone(repository) || Option.isNone(files)) return undefined
    const state = yield* repository.value
      .getProjectionState(sessionId)
      .pipe(Effect.orElseSucceed(() => null))
    if (!state?.piSessionFile) return undefined
    if (!state.piEntryNodeIdPrefix && state.projectedPiEntryCount === 0) return undefined
    const deleted = yield* files.value.isDeleted(state.piSessionFile)
    const unavailable = deleted ? undefined : yield* files.value.unavailability(state.piSessionFile)
    if (!deleted && !unavailable) return undefined
    return {
      file: state.piSessionFile,
      unavailable,
      discovered: state.piEntryNodeIdPrefix !== undefined,
      repository: repository.value,
    }
  })
}

type MissingPiSessionFile = NonNullable<
  Effect.Effect.Success<ReturnType<typeof deletedPiSessionFile>>
>

/** What an opened Session OpenWaggle created says once its Pi file was deleted. */
export const CREATED_SESSION_FILE_DELETED =
  "This Session's Pi file was deleted; the next message starts a new transcript."

/**
 * An opened Session, with what its Pi file's deletion means for it: why a discovered Session
 * cannot be continued, or that a created Session's next message starts over.
 */
export function withDeletedPiSessionFileNotice(detail: SessionDetail | null) {
  if (!detail) return Effect.succeed(detail)
  return Effect.gen(function* () {
    const deleted = yield* deletedPiSessionFile(detail.id)
    if (!deleted) return detail
    const notice =
      deleted.discovered || deleted.unavailable
        ? (yield* refusedRunError(detail.id, deleted)).message
        : CREATED_SESSION_FILE_DELETED
    return { ...detail, piSessionFileDeleted: notice }
  })
}

function refusedRunError(sessionId: SessionId, deleted: MissingPiSessionFile) {
  if (deleted.unavailable) {
    return Effect.succeed(new UnavailablePiSessionFileError(deleted.file, deleted.unavailable))
  }
  return deleted.repository.deletionRefusal(sessionId).pipe(
    Effect.orElseSucceed(() => undefined),
    Effect.flatMap((refusal) => (refusal ? namedDependency(refusal) : Effect.succeed(undefined))),
    Effect.map((dependsOn) => new DeletedPiSessionFileError(deleted.file, dependsOn)),
  )
}

/**
 * Before a Run: a discovered Session whose Pi file was deleted or is out of reach is refused, never
 * continued in a new file under the same id, as is any Session whose Pi folder is out of reach.
 * One OpenWaggle created whose file was deleted from its folder still runs: Pi starts a new file
 * under its Pi session id, without what came before, and the Run's snapshot of that file replaces
 * the transcript shown, so the earlier messages go (`warnIfTranscriptLost`). It is logged once,
 * and the Session says so when it is opened, before that next message.
 */
export function refuseRunWithDeletedPiFile(sessionId: SessionId) {
  return Effect.gen(function* () {
    const deleted = yield* deletedPiSessionFile(sessionId)
    if (!deleted) return
    if (deleted.discovered || deleted.unavailable) {
      return yield* Effect.fail(yield* refusedRunError(sessionId, deleted))
    }
    // Once per Session and file: each Run checks before it reads the Session, and again before Pi.
    const key = `${sessionId}:${deleted.file}`
    if (warnedDeletedFiles.has(key)) return
    warnedDeletedFiles.add(key)
    logger.warn(
      "A Session's Pi session file was deleted outside OpenWaggle; the Run starts a new one without the earlier context",
      { sessionId, piSessionFile: deleted.file },
    )
  })
}
