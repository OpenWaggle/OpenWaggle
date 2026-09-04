import type { SessionId } from '@shared/types/brand'
import type { GitRunStackedActionResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import {
  type PendingCommitOutput,
  pendingChangeRequestOutput,
  pendingCommitOutput,
  putPendingSessionOutput,
  removePendingSessionOutput,
} from '../../application/session-change-request-output-retry'
import { withSessionResourceLock } from '../../application/session-resource-lock'
import {
  recordSessionChangeRequest,
  recordSessionCommit,
  type SessionOutputOccurrenceContext,
} from '../../application/session-resource-recording'
import { createLogger } from '../../logger'
import { broadcastToWindows } from '../../utils/broadcast'

const logger = createLogger('ipc/git-stacked-action')

function recordCommitOutputUnlocked(
  commit: PendingCommitOutput,
  sessionId: SessionId,
  occurrenceContext: SessionOutputOccurrenceContext,
) {
  return Effect.gen(function* () {
    const pending = pendingCommitOutput(sessionId, commit, occurrenceContext)
    const queued = yield* putPendingSessionOutput(pending).pipe(Effect.either)
    const winningPending = queued._tag === 'Right' ? queued.right : pending
    const winningCommit = winningPending.kind === 'commit' ? winningPending : pending
    const recording = yield* recordSessionCommit(sessionId, winningCommit, winningCommit).pipe(
      Effect.either,
    )
    if (recording._tag === 'Left') {
      logger.warn('Could not record committed output', {
        sessionId,
        commitHash: commit.commitHash,
        error: String(recording.left),
        retryPersisted: queued._tag === 'Right',
      })
      return {
        ok: false as const,
        retryPersisted: queued._tag === 'Right',
        message:
          queued._tag === 'Right'
            ? 'The commit succeeded, but it could not be added to this session Outputs yet. Summary will retry it automatically.'
            : 'The commit succeeded, but its Output and durable retry could not be recorded.',
      }
    }
    if (queued._tag === 'Right') {
      yield* removePendingSessionOutput(winningPending).pipe(Effect.catchAll(() => Effect.void))
    }
    return { ok: true as const }
  }).pipe(
    Effect.tap(() =>
      Effect.sync(() => broadcastToWindows('sessions:resources-invalidated', { sessionId })),
    ),
  )
}

/** Record one successful commit as a durable, retryable Session Output. */
export function recordSessionCommitOutput(
  commit: PendingCommitOutput,
  sessionId: SessionId,
  occurrenceContext: SessionOutputOccurrenceContext,
) {
  return withSessionResourceLock(
    sessionId,
    recordCommitOutputUnlocked(commit, sessionId, occurrenceContext),
  )
}

function attachCommitOutput(
  result: GitRunStackedActionResult,
  sessionId: SessionId,
  occurrenceContext: SessionOutputOccurrenceContext,
) {
  return Effect.gen(function* () {
    if (!result.commit) return result
    const commitOutput = yield* recordCommitOutputUnlocked(
      result.commit,
      sessionId,
      occurrenceContext,
    )
    return { ...result, commitOutput }
  })
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
    const winningPending = queued._tag === 'Right' ? queued.right : pending
    const winningRequest = winningPending.kind === 'change-request' ? winningPending : pending
    const recording = yield* recordSessionChangeRequest(
      sessionId,
      winningRequest,
      winningRequest,
    ).pipe(Effect.either)
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
      yield* removePendingSessionOutput(winningPending).pipe(Effect.catchAll(() => Effect.void))
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
  return withSessionResourceLock(
    sessionId,
    Effect.gen(function* () {
      const withCommit = yield* attachCommitOutput(result, sessionId, occurrenceContext)
      return yield* recordChangeRequestOutput(withCommit, sessionId, occurrenceContext)
    }),
  )
}
