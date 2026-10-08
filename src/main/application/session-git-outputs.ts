import type { SessionId } from '@shared/types/brand'
import type { SessionGitOutputsPayload, SessionGitWorkingPathVerification } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { verifySessionWorkingPath } from '../services/git/session-working-path'
import { recordSessionGitOutputs } from './session-git-output-recording'
import { resolveSessionOutputOccurrenceContext } from './session-resource-recording'

/**
 * Whether a working path belongs to a Session, and where its Git Outputs anchor in the Session
 * tree. Runs where Sessions live: the Session Host for an attached window (ADR 0048).
 */
export function verifySessionGitWorkingPath(sessionId: SessionId, workingPath: string) {
  return Effect.gen(function* () {
    if (!(yield* verifySessionWorkingPath(sessionId, workingPath))) {
      return { owned: false } satisfies SessionGitWorkingPathVerification
    }
    const context = yield* resolveSessionOutputOccurrenceContext(sessionId).pipe(
      Effect.catchAll(() =>
        Effect.succeed({ nodeId: null, branchId: null, createdAt: Date.now() }),
      ),
    )
    return {
      owned: true,
      occurrence: {
        nodeId: context.nodeId,
        branchId: context.branchId,
        createdAt: context.createdAt,
      },
    } satisfies SessionGitWorkingPathVerification
  })
}

export function recordSessionGitOutputsOperation(
  sessionId: SessionId,
  payload: SessionGitOutputsPayload,
) {
  return recordSessionGitOutputs(sessionId, payload)
}
