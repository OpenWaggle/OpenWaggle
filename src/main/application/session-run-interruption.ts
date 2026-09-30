import { randomUUID } from 'node:crypto'
import type { SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { dispatchLocalSessionCommand } from './local-session-command-dispatcher'

/** Stops a Session's active run, or its standalone compaction, through the Session Host. */
export function interruptSessionRun(sessionId: SessionId) {
  return Effect.gen(function* () {
    const statusResult = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user' },
      payload: {
        contract: 'session-query-v2',
        request: {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: randomUUID(),
          query: { operation: 'status', sessionId },
        },
      },
    })
    if (
      statusResult.contract !== 'session-query-v2' ||
      statusResult.response.outcome.operation !== 'status' ||
      'error' in statusResult.response.outcome
    ) {
      return
    }
    if (statusResult.response.outcome.activeRunId) {
      yield* dispatchLocalSessionCommand({
        caller: { callerId: 'gui:local-user' },
        payload: {
          contract: 'session-control-v2',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: randomUUID(),
            idempotencyKey: randomUUID(),
            command: {
              operation: 'interrupt',
              sessionId,
              expectedRunId: statusResult.response.outcome.activeRunId,
            },
          },
        },
      })
      return
    }
    const requestId = randomUUID()
    const cancellation = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user' },
      payload: {
        contract: 'local-compaction-cancel-v1',
        request: { requestId, sessionId },
      },
    })
    if (
      cancellation.contract !== 'local-compaction-cancel-v1' ||
      cancellation.response.requestId !== requestId ||
      cancellation.response.sessionId !== sessionId
    ) {
      return yield* Effect.fail(
        new Error('Session Host returned an invalid compaction cancellation response.'),
      )
    }
  })
}
