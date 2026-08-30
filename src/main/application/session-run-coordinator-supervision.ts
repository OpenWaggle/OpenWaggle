import type { RunId, SessionId } from '@shared/types/brand'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { tryGetSessionHostEventRuntime } from '../session-host/session-host-events'

const logger = createLogger('session-run-coordinator/supervision')

export function forkSupervisedSessionRuns<A, E, R>(input: {
  readonly sessionId: SessionId
  readonly runId: RunId
  readonly effect: Effect.Effect<A, E, R>
}) {
  return input.effect.pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.error('Durable Run coordination failed; draining Session Host for recovery.', {
          cause: Cause.pretty(cause),
          runId: input.runId,
          sessionId: input.sessionId,
        })
        tryGetSessionHostEventRuntime()?.liveness.requestDrain()
      }),
    ),
    Effect.forkDaemon,
  )
}
