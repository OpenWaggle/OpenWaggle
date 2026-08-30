import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import type { SessionExportOperationRecord } from '../ports/session-export-operation-repository'
import { tryGetSessionHostEventRuntime } from '../session-host/session-host-events'

const logger = createLogger('session-export/supervision')

export function forkSupervisedSessionExport<A, E, R>(input: {
  readonly operation: SessionExportOperationRecord
  readonly effect: Effect.Effect<A, E, R>
}) {
  return input.effect.pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.error('Durable export coordination failed; draining Session Host for recovery.', {
          cause: Cause.pretty(cause),
          exportOperationId: input.operation.exportOperationId,
          sessionId: input.operation.sessionId,
        })
        tryGetSessionHostEventRuntime()?.liveness.requestDrain()
      }),
    ),
    Effect.forkDaemon,
  )
}
