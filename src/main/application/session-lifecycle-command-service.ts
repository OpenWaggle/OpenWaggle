import { matchBy } from '@diegogbrisa/ts-match'
import { RunId, SessionId } from '@shared/types/brand'
import type { SessionLifecycleResponse } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { reserveActiveSessionRun } from './active-session-runs'
import { coordinateSessionRuns } from './session-control-run-coordinator'
import { acquireSessionHostRunLease, type SessionHostRunLease } from './session-host-run-admission'
import {
  type ExecuteSessionLifecycleCommandInput,
  executeSessionLifecycle,
} from './session-lifecycle-service'
import { forkSupervisedSessionRuns } from './session-run-coordinator-supervision'

export function dispatchAcceptedLifecycleRun(
  response: SessionLifecycleResponse,
  lease?: SessionHostRunLease,
  beforeDispatch: Effect.Effect<void, unknown> = Effect.void,
) {
  const startingRun = matchBy(response.outcome, 'effect')
    .with('launched-root', 'spawned-worker', (outcome) => ({
      sessionId: outcome.sessionId,
      runId: outcome.runId,
    }))
    .with('created-root', 'forked-session', 'rejected', () => null)
    .exhaustive()
  if (response.replayed || !startingRun) return Effect.succeed(false)

  const sessionId = SessionId(startingRun.sessionId)
  const runId = RunId(startingRun.runId)
  return beforeDispatch.pipe(
    Effect.zipRight(
      Effect.sync(() => reserveActiveSessionRun(sessionId, runId)).pipe(
        Effect.flatMap((initialReservation) =>
          forkSupervisedSessionRuns({
            sessionId,
            runId,
            effect: coordinateSessionRuns({
              sessionId,
              startingRunId: runId,
              initialReservation,
              ...(lease ? { lease } : {}),
            }),
          }).pipe(
            Effect.catchAllCause((cause) =>
              Effect.sync(initialReservation.release).pipe(
                Effect.zipRight(Effect.failCause(cause)),
              ),
            ),
          ),
        ),
      ),
    ),
    Effect.as(true),
  )
}

type ExecuteSessionLifecycleCommandOptions = ExecuteSessionLifecycleCommandInput & {
  readonly beforeDispatchAcceptedRun?: (
    response: SessionLifecycleResponse,
  ) => Effect.Effect<void, unknown>
}

export function executeSessionLifecycleCommand(input: ExecuteSessionLifecycleCommandOptions) {
  return Effect.gen(function* () {
    const mayStartRun =
      input.request.command.operation === 'launch' || input.request.command.operation === 'spawn'
    const lease = mayStartRun ? yield* acquireSessionHostRunLease('run') : undefined
    let transferred = false
    return yield* executeSessionLifecycle(input).pipe(
      Effect.tap((response) =>
        dispatchAcceptedLifecycleRun(
          response,
          lease,
          input.beforeDispatchAcceptedRun?.(response),
        ).pipe(
          Effect.tap((didTransfer) =>
            Effect.sync(() => {
              transferred = didTransfer
            }),
          ),
        ),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (!transferred) lease?.release()
        }),
      ),
    )
  })
}
