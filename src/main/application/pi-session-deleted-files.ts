import type { SessionId } from '@shared/types/brand'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { createLogger } from '../logger'
import { PiSessionDiscoveryRepository, PiSessionFiles } from '../ports/pi-session-discovery'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { hasAnyActiveRun, isSessionRemovalFenced } from './active-session-runs'
import { runSessionRemovalHooks } from './session-removal-hooks'

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
      `This Session's Pi session file was deleted outside OpenWaggle (${piSessionFile}), so its history is gone and it cannot be continued. OpenWaggle removes the Session from the sidebar.`,
    )
    this.name = 'DeletedPiSessionFileError'
  }
}

/**
 * Removes each discovered Session whose Pi file was deleted, through the deletion path any
 * removal takes, and announces it as deleted. A Session with a Run, or one being removed, is left
 * for a later pass; its Run is refused instead. Nothing is dismissed and no copy is deleted, so a
 * file restored later is discovered again.
 */
export function removeSessionsWithDeletedPiFiles() {
  return Effect.gen(function* () {
    const repository = yield* PiSessionDiscoveryRepository
    const files = yield* PiSessionFiles
    const projections = yield* SessionProjectionRepository
    for (const { sessionId, piSessionFile } of yield* repository.listAdoptedPiSessionFiles()) {
      if (hasAnyActiveRun(sessionId) || isSessionRemovalFenced(sessionId)) continue
      if (!(yield* files.isDeleted(piSessionFile))) continue
      yield* runSessionRemovalHooks(sessionId)
      yield* projections.delete(sessionId, { removingProject: true })
      publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'deleted' })
      logger.info('Removed a Session whose Pi session file was deleted', {
        sessionId,
        piSessionFile,
      })
    }
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.warn('Could not remove Sessions whose Pi session files were deleted', {
          error: formatErrorMessage(Cause.squash(cause)),
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
