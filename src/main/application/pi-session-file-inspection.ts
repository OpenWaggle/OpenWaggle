import type { PiSessionFileUnavailability } from '@shared/domain/pi-session-file-messages'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import {
  PiSessionDiscoveryRepository,
  type PiSessionDiscoveryRepositoryShape,
  PiSessionFiles,
} from '../ports/pi-session-discovery'
import { SessionProjectionRepository } from '../ports/session-projection-repository'

/*
 * Whether a Session's Pi file can be used: deleted outside OpenWaggle, out of reach, or, for a
 * created Session, replaced by a copy its Run continues.
 */

export interface MissingPiSessionFile {
  readonly file: string
  readonly unavailable?: PiSessionFileUnavailability
  readonly unreadableFolder?: string
  readonly discovered: boolean
  readonly repository: PiSessionDiscoveryRepositoryShape
}

/**
 * What {@link deletedPiSessionFile} finds, with, for a created Session whose file was deleted,
 * the copy its Run continues.
 */
export function inspectPiSessionFile(sessionId: SessionId): Effect.Effect<{
  readonly missing?: MissingPiSessionFile
  readonly continuedCopy?: string
}> {
  return Effect.gen(function* () {
    const repository = yield* Effect.serviceOption(PiSessionDiscoveryRepository)
    const files = yield* Effect.serviceOption(PiSessionFiles)
    if (Option.isNone(repository) || Option.isNone(files)) return {}
    const state = yield* repository.value
      .getProjectionState(sessionId)
      .pipe(Effect.orElseSucceed(() => null))
    if (!state?.piSessionFile) return {}
    if (!state.piEntryNodeIdPrefix && state.projectedPiEntryCount === 0) return {}
    const deleted = yield* files.value.isDeleted(state.piSessionFile)
    const { unavailable, unreadableFolder, continuedCopy } = deleted
      ? yield* deletedFileUnavailability(sessionId, state.piEntryNodeIdPrefix)
      : { unavailable: yield* files.value.unavailability(state.piSessionFile) }
    if (unavailable === 'continued') return continuedCopy ? { continuedCopy } : {}
    if (!deleted && !unavailable) return {}
    return {
      missing: {
        file: state.piSessionFile,
        ...(unavailable ? { unavailable } : {}),
        ...(unreadableFolder ? { unreadableFolder } : {}),
        discovered: state.piEntryNodeIdPrefix !== undefined,
        repository: repository.value,
      },
    }
  })
}

/**
 * A deleted file's Session: a created one's Run continues a copy under its Pi session id when
 * there is one, and cannot tell while a folder that may hold one cannot be read.
 */
function deletedFileUnavailability(
  sessionId: SessionId,
  piEntryNodeIdPrefix?: string,
): Effect.Effect<{
  readonly unavailable?: 'continued' | 'copies'
  readonly unreadableFolder?: string
  readonly continuedCopy?: string
}> {
  if (piEntryNodeIdPrefix) return Effect.succeed({})
  return createdSessionContinuation(sessionId).pipe(
    Effect.map((continuation) => {
      if (continuation?.kind === 'file') {
        return { unavailable: 'continued', continuedCopy: continuation.file }
      }
      if (continuation?.kind !== 'unsearchable') return {}
      return { unavailable: 'copies', unreadableFolder: continuation.folder }
    }),
  )
}

function createdSessionContinuation(sessionId: SessionId) {
  return Effect.gen(function* () {
    const files = yield* Effect.serviceOption(PiSessionFiles)
    const projections = yield* Effect.serviceOption(SessionProjectionRepository)
    if (Option.isNone(files) || Option.isNone(projections)) return null
    const detail = yield* projections.value
      .getOptional(sessionId)
      .pipe(Effect.orElseSucceed(() => null))
    return detail ? yield* files.value.continuedFile(detail) : null
  })
}
