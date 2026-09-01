import type { SessionId } from '@shared/types/brand'
import type { GitRunStackedActionResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import {
  clearPendingChangeRequestOutput,
  clearPendingCommitOutput,
  registerPendingChangeRequestOutput,
  registerPendingCommitOutput,
} from '../../application/session-change-request-output-retry'
import {
  recordSessionChangeRequest,
  recordSessionCommit,
} from '../../application/session-resource-recording'
import { createLogger } from '../../logger'
import { broadcastToWindows } from '../../utils/broadcast'

const logger = createLogger('ipc/git-stacked-action')

function recordCommitOutput(result: GitRunStackedActionResult, sessionId: SessionId) {
  return Effect.gen(function* () {
    if (!result.commit) return result
    const recording = yield* recordSessionCommit(sessionId, result.commit).pipe(Effect.either)
    if (recording._tag === 'Left') {
      registerPendingCommitOutput(sessionId, result.commit)
      logger.warn('Could not record committed output', {
        sessionId,
        commitHash: result.commit.commitHash,
        error: String(recording.left),
      })
      return {
        ...result,
        commitOutput: {
          ok: false as const,
          message:
            'The commit succeeded, but it could not be added to this session Outputs yet. Summary will retry it automatically.',
        },
      }
    }
    clearPendingCommitOutput(sessionId, result.commit.commitHash)
    return { ...result, commitOutput: { ok: true as const } }
  }).pipe(
    Effect.tap(() =>
      result.commit
        ? Effect.sync(() => broadcastToWindows('sessions:resources-invalidated', { sessionId }))
        : Effect.void,
    ),
  )
}

function recordChangeRequestOutput(result: GitRunStackedActionResult, sessionId: SessionId) {
  return Effect.gen(function* () {
    if (!result.ok || !result.changeRequest) return result
    const createdRequest = {
      title: result.changeRequest.title,
      url: result.changeRequest.url,
    }
    const recording = yield* recordSessionChangeRequest(sessionId, createdRequest).pipe(
      Effect.either,
    )
    if (recording._tag === 'Left') {
      registerPendingChangeRequestOutput(sessionId, createdRequest)
      logger.warn('Could not record created change request output', {
        sessionId,
        url: result.changeRequest.url,
        error: String(recording.left),
      })
      return {
        ...result,
        changeRequestOutput: {
          ok: false as const,
          message:
            'The change request was created, but it could not be added to this session Outputs.',
        },
      }
    }
    clearPendingChangeRequestOutput(sessionId, createdRequest)
    broadcastToWindows('sessions:resources-invalidated', { sessionId })
    return { ...result, changeRequestOutput: { ok: true as const } }
  })
}

export function recordStackedActionOutputs(
  result: GitRunStackedActionResult,
  sessionId: SessionId,
) {
  return Effect.gen(function* () {
    const withCommit = yield* recordCommitOutput(result, sessionId)
    return yield* recordChangeRequestOutput(withCommit, sessionId)
  })
}
