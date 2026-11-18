import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { PiSessionDiscoveryRepository } from '../ports/pi-session-discovery'
import { pausePiSessionDiscovery } from './pi-session-discovery-pauses'

/**
 * `sessions:begin-project-removal`: the desktop app is about to read the Sessions of a project it
 * removes. Discovery stops listing the project's Pi sessions first, so the list it reads, and
 * deletes, stays complete.
 */
export function beginPiSessionProjectRemoval(projectPath: string) {
  pausePiSessionDiscovery(projectPath)
}

/**
 * Deletes one Session as part of removing its project (ADR 0051). Unlike deleting a single
 * discovered Session, the deletion does not dismiss its Pi file: the file stays for the `pi` CLI,
 * and the session is listed again if the folder is added back. Discovery pauses for the project
 * until its removal finishes, so it neither lists the file again meanwhile nor adds Sessions to a
 * project the removal is checking.
 */
export function deleteSessionForProjectRemoval<E, R>(
  sessionId: SessionId,
  deletion: Effect.Effect<void, E, R>,
) {
  return Effect.gen(function* () {
    const repository = yield* Effect.serviceOption(PiSessionDiscoveryRepository)
    const state = Option.isSome(repository)
      ? yield* repository.value.getProjectionState(sessionId).pipe(Effect.orElseSucceed(() => null))
      : null
    if (state?.projectPath) pausePiSessionDiscovery(state.projectPath)
    yield* deletion
  })
}
