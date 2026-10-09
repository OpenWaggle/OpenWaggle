import type { SessionId } from '@shared/types/brand'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { createLogger } from '../logger'
import { PiSessionDiscoveryRepository, PiSessionFiles } from '../ports/pi-session-discovery'
import { hasAnyActiveRun, isSessionRemovalFenced } from './active-session-runs'
import { withSessionDesktopRemoval } from './session-desktop-removal'
import { deleteSessionWithVisualizations } from './session-visualization-deletion'

/**
 * A discovered Session's history is its Pi file (ADR 0050). When something outside OpenWaggle
 * deletes it, as Pi's `/resume` picker can, the Session is gone too: continuing it would start a
 * new file under the same Pi session id, which loses the history in OpenWaggle and brings the
 * deleted session back to `pi --resume`.
 */

const logger = createLogger('pi-session-deleted-files')

export class DeletedPiSessionFileError extends Error {
  constructor(piSessionFile: string) {
    super(
      `This Session's Pi session file was deleted outside OpenWaggle (${piSessionFile}), so its history is gone and it cannot be continued. Restore the file to continue it, or delete the Session.`,
    )
    this.name = 'DeletedPiSessionFileError'
  }
}

/** Sessions kept because others depend on them, reported once per Host rather than every pass. */
const keptSessions = new Set<string>()

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
      if (!(yield* files.isDeleted(piSessionFile))) continue
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
 * Before a Run: a discovered Session whose Pi file was deleted is refused, never continued in a
 * new file under the same id. A Session OpenWaggle created keeps its own transcript, so its Run
 * still starts, in a new Pi file, with a warning that Pi lost what came before.
 */
export function refuseRunWithDeletedPiFile(sessionId: SessionId) {
  return Effect.gen(function* () {
    const repository = yield* Effect.serviceOption(PiSessionDiscoveryRepository)
    const files = yield* Effect.serviceOption(PiSessionFiles)
    if (Option.isNone(repository) || Option.isNone(files)) return
    const state = yield* repository.value
      .getProjectionState(sessionId)
      .pipe(Effect.orElseSucceed(() => null))
    if (!state?.piSessionFile || !(yield* files.value.isDeleted(state.piSessionFile))) return
    if (state.piEntryNodeIdPrefix) {
      return yield* Effect.fail(new DeletedPiSessionFileError(state.piSessionFile))
    }
    logger.warn(
      "A Session's Pi session file was deleted outside OpenWaggle; the Run starts a new one without the earlier context",
      { sessionId, piSessionFile: state.piSessionFile },
    )
  })
}
