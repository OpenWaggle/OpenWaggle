import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'

const logger = createLogger('session-control/attachment-cleanup')

export function preserveOutcomeAfterAttachmentCleanup<A, E, R, E2, R2>(input: {
  readonly effect: Effect.Effect<A, E, R>
  readonly cleanup: Effect.Effect<void, E2, R2>
  readonly operation: 'command' | 'run'
  readonly sessionId: string
}) {
  const cleanup = input.cleanup.pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.error('Attachment cleanup failed after the authoritative outcome was decided.', {
          cause: Cause.pretty(cause),
          operation: input.operation,
          sessionId: input.sessionId,
        })
      }),
    ),
  )
  return input.effect.pipe(Effect.ensuring(cleanup))
}
