import type { SessionId } from '@shared/types/brand'
import type { GitRunStackedActionResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import {
  pendingChangeRequestOutput,
  pendingCommitOutput,
  putPendingSessionOutput,
  removePendingSessionOutput,
} from '../../application/session-change-request-output-retry'
import {
  recordSessionChangeRequest,
  recordSessionCommit,
  type SessionOutputOccurrenceContext,
} from '../../application/session-resource-recording'
import { createLogger } from '../../logger'
import { broadcastToWindows } from '../../utils/broadcast'

const logger = createLogger('ipc/git-stacked-action')

function recordCommitOutput(
  result: GitRunStackedActionResult,
  sessionId: SessionId,
  occurrenceContext: SessionOutputOccurrenceContext,
) {
  return Effect.gen(function* () {
    if (!result.commit) return result
    const pending = pendingCommitOutput(sessionId, result.commit, occurrenceContext)
    const queued = yield* putPendingSessionOutput(pending).pipe(Effect.either)
    const recording = yield* recordSessionCommit(sessionId, result.commit, pending).pipe(
      Effect.either,
    )
    if (recording._tag === 'Left') {
      logger.warn('Could not record committed output', {
        sessionId,
        commitHash: result.commit.commitHash,
        error: String(recording.left),
        retryPersisted: queued._tag === 'Right',
      })
      return {
        ...result,
        commitOutput: {
          ok: false as const,
          retryPersisted: queued._tag === 'Right',
          message:
            queued._tag === 'Right'
              ? 'The commit succeeded, but it could not be added to this session Outputs yet. Summary will retry it automatically.'
              : 'The commit succeeded, but its Output and durable retry could not be recorded.',
        },
      }
    }
    if (queued._tag === 'Right') {
      yield* removePendingSessionOutput(pending).pipe(Effect.catchAll(() => Effect.void))
    }
    return { ...result, commitOutput: { ok: true as const } }
  }).pipe(
    Effect.tap(() =>
      result.commit
        ? Effect.sync(() => broadcastToWindows('sessions:resources-invalidated', { sessionId }))
        : Effect.void,
    ),
  )
}

function recordChangeRequestOutput(
  result: GitRunStackedActionResult,
  sessionId: SessionId,
  occurrenceContext: SessionOutputOccurrenceContext,
) {
  return Effect.gen(function* () {
    if (!result.ok || !result.changeRequest) return result
    const createdRequest = {
      title: result.changeRequest.title,
      url: result.changeRequest.url,
    }
    const pending = pendingChangeRequestOutput(sessionId, createdRequest, occurrenceContext)
    const queued = yield* putPendingSessionOutput(pending).pipe(Effect.either)
    const recording = yield* recordSessionChangeRequest(sessionId, createdRequest, pending).pipe(
      Effect.either,
    )
    if (recording._tag === 'Left') {
      logger.warn('Could not record created change request output', {
        sessionId,
        url: result.changeRequest.url,
        error: String(recording.left),
        retryPersisted: queued._tag === 'Right',
      })
      return {
        ...result,
        changeRequestOutput: {
          ok: false as const,
          retryPersisted: queued._tag === 'Right',
          message:
            queued._tag === 'Right'
              ? 'The change request was created, but it could not be added to this session Outputs yet. Summary will retry it automatically.'
              : 'The change request was created, but its Output and durable retry could not be recorded.',
        },
      }
    }
    if (queued._tag === 'Right') {
      yield* removePendingSessionOutput(pending).pipe(Effect.catchAll(() => Effect.void))
    }
    broadcastToWindows('sessions:resources-invalidated', { sessionId })
    return { ...result, changeRequestOutput: { ok: true as const } }
  })
}

export function recordStackedActionOutputs(
  result: GitRunStackedActionResult,
  sessionId: SessionId,
  occurrenceContext: SessionOutputOccurrenceContext,
) {
  return Effect.gen(function* () {
    const withCommit = yield* recordCommitOutput(result, sessionId, occurrenceContext)
    return yield* recordChangeRequestOutput(withCommit, sessionId, occurrenceContext)
  })
}
