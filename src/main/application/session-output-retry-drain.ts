import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import {
  listPendingSessionOutputs,
  removePendingSessionOutput,
} from './session-change-request-output-retry'
import {
  clearPendingSessionOutputRetry,
  schedulePendingSessionOutputRetry,
} from './session-output-retry-backoff'
import { withSessionResourceLock } from './session-resource-lock'
import { recordSessionChangeRequest, recordSessionCommit } from './session-resource-recording'

function drainPendingSessionOutputsUnlocked(sessionId: SessionId) {
  return Effect.gen(function* () {
    const listed = yield* listPendingSessionOutputs(sessionId).pipe(Effect.either)
    if (listed._tag === 'Left') return { retryPending: true }

    let retryPending = false
    for (const output of listed.right) {
      const recording =
        output.kind === 'commit'
          ? recordSessionCommit(sessionId, output, output)
          : recordSessionChangeRequest(sessionId, output, output)
      const recorded = yield* recording.pipe(Effect.either)
      if (recorded._tag === 'Left') {
        retryPending = true
        continue
      }
      const removed = yield* removePendingSessionOutput(output).pipe(Effect.either)
      if (removed._tag === 'Left') retryPending = true
    }
    return { retryPending }
  })
}

/** Best-effort durable Output recovery performed before a Session catalog read. */
export function drainPendingSessionOutputs(sessionId: SessionId) {
  return withSessionResourceLock(sessionId, drainPendingSessionOutputsUnlocked(sessionId)).pipe(
    Effect.tap(({ retryPending }) =>
      Effect.sync(() => {
        if (retryPending) schedulePendingSessionOutputRetry(sessionId)
        else clearPendingSessionOutputRetry(sessionId)
      }),
    ),
  )
}
