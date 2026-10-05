import { randomUUID } from 'node:crypto'
import type { SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { listHostUiActiveActivities } from './host-ui-agent-operation'
import { dispatchLocalSessionCommand } from './local-session-command-dispatcher'

const logger = createLogger('session-run-interruption')

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

/**
 * Stops every active run and standalone compaction this Session Host owns, through normal
 * cancellation, so each ends as interrupted. One Session that cannot be stopped does not keep the
 * others running.
 */
export function interruptAllSessionRuns() {
  return Effect.gen(function* () {
    const activities = yield* listHostUiActiveActivities()
    const sessionIds = new Set(activities.map((activity) => activity.sessionId))
    yield* Effect.forEach(
      sessionIds,
      (sessionId) =>
        interruptSessionRun(sessionId).pipe(
          Effect.catchAllCause((cause) =>
            Effect.sync(() =>
              logger.warn('Could not interrupt a Run', { sessionId, cause: Cause.pretty(cause) }),
            ),
          ),
        ),
      { concurrency: 'unbounded', discard: true },
    )
  })
}
