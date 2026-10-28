import type { SessionId } from '@shared/types/brand'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { listHostUiActiveActivities } from './host-ui-agent-operation'
import { dispatchLocalSessionCommand } from './local-session-command-dispatcher'
import { interruptSessionRunThrough } from './session-run-interruption-command'

const logger = createLogger('session-run-interruption')

type HostDispatch = ReturnType<typeof dispatchLocalSessionCommand>

/** Stops a Session's active run, or its standalone compaction, in this Session Host. */
export function interruptSessionRun(sessionId: SessionId) {
  return interruptSessionRunThrough<
    Effect.Effect.Error<HostDispatch>,
    Effect.Effect.Context<HostDispatch>
  >(dispatchLocalSessionCommand, sessionId)
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
