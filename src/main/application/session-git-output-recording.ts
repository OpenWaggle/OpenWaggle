import type { SessionId } from '@shared/types/brand'
import type {
  GitOutputRecordingResult,
  SessionGitOutputsPayload,
  SessionGitOutputsRecording,
} from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import {
  type PendingCommitOutput,
  pendingChangeRequestOutput,
  pendingCommitOutput,
  putPendingSessionOutput,
  removePendingSessionOutput,
} from './session-change-request-output-retry'
import { beginPendingSessionOutputRetry } from './session-output-retry-backoff'
import { withSessionResourceLock } from './session-resource-lock'
import {
  recordSessionChangeRequest,
  recordSessionCommit,
  type SessionOutputOccurrenceContext,
} from './session-resource-recording'

const logger = createLogger('ipc/git-stacked-action')

function retryWasPersisted(output: GitOutputRecordingResult | undefined) {
  return output?.ok === false && output.retryPersisted
}

function wakePendingOutputRetry(
  sessionId: SessionId,
  outputs: readonly (GitOutputRecordingResult | undefined)[],
) {
  return outputs.some(retryWasPersisted)
    ? Effect.sync(() => beginPendingSessionOutputRetry(sessionId))
    : Effect.void
}

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
  })
}

function recordChangeRequestOutputUnlocked(
  createdRequest: { readonly title: string; readonly url: string },
  sessionId: SessionId,
  occurrenceContext: SessionOutputOccurrenceContext,
) {
  return Effect.gen(function* () {
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
        url: createdRequest.url,
        error: String(recording.left),
        retryPersisted: queued._tag === 'Right',
      })
      return {
        ok: false as const,
        retryPersisted: queued._tag === 'Right',
        message:
          queued._tag === 'Right'
            ? 'The change request was created, but it could not be added to this session Outputs yet. Summary will retry it automatically.'
            : 'The change request was created, but its Output and durable retry could not be recorded.',
      }
    }
    if (queued._tag === 'Right') {
      yield* removePendingSessionOutput(winningPending).pipe(Effect.catchAll(() => Effect.void))
    }
    return { ok: true as const }
  })
}

/**
 * Record a Session-scoped commit and/or created change request as Session Outputs. The Session
 * Host runs this for the desktop window, whose database cannot see Sessions (ADR 0048).
 */
export function recordSessionGitOutputs(sessionId: SessionId, payload: SessionGitOutputsPayload) {
  const occurrenceContext: SessionOutputOccurrenceContext = {
    nodeId: payload.occurrence.nodeId,
    branchId: payload.occurrence.branchId,
    createdAt: payload.occurrence.createdAt,
    updatedAt: payload.occurrence.createdAt,
  }
  return withSessionResourceLock(
    sessionId,
    Effect.gen(function* () {
      const commitOutput = payload.commit
        ? yield* recordCommitOutputUnlocked(payload.commit, sessionId, occurrenceContext)
        : undefined
      const changeRequestOutput = payload.changeRequest
        ? yield* recordChangeRequestOutputUnlocked(
            payload.changeRequest,
            sessionId,
            occurrenceContext,
          )
        : undefined
      return {
        ...(commitOutput ? { commitOutput } : {}),
        ...(changeRequestOutput ? { changeRequestOutput } : {}),
      } satisfies SessionGitOutputsRecording
    }),
  ).pipe(
    Effect.tap((recorded) =>
      wakePendingOutputRetry(sessionId, [recorded.commitOutput, recorded.changeRequestOutput]),
    ),
  )
}
