import { matchBy } from '@diegogbrisa/ts-match'
import { RunId, SessionId } from '@shared/types/brand'
import type { SessionLifecycleResponse } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import type { SessionControlIdentityService } from '../ports/session-control-identity-service'
import type { SessionControlRunExecutor } from '../ports/session-control-run-executor'
import type { SessionControlRunLifecycleRepository } from '../ports/session-control-run-lifecycle-repository'
import type { SessionLifecycleIdentityService } from '../ports/session-lifecycle-identity-service'
import type { SessionLifecyclePreparationService } from '../ports/session-lifecycle-preparation-service'
import type { SessionLifecycleRepository } from '../ports/session-lifecycle-repository'
import type { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'
import { reserveActiveSessionRun } from './active-session-runs'
import { coordinateSessionRuns } from './session-control-run-coordinator'
import { acquireSessionHostRunLease, type SessionHostRunLease } from './session-host-run-admission'
import {
  type ExecuteSessionLifecycleCommandInput,
  executeSessionLifecycle,
} from './session-lifecycle-service'
import { forkSupervisedSessionRuns } from './session-run-coordinator-supervision'

type SessionLifecycleDispatchDependencies =
  | SessionControlIdentityService
  | SessionControlRunExecutor
  | SessionControlRunLifecycleRepository
  | SessionOrchestrationUpdateDeliveryService

type SessionLifecycleCommandDependencies =
  | SessionLifecycleIdentityService
  | SessionLifecyclePreparationService
  | SessionLifecycleRepository
  | SessionLifecycleDispatchDependencies

export function dispatchAcceptedLifecycleRun(
  response: SessionLifecycleResponse,
  lease?: SessionHostRunLease,
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
  return Effect.sync(() => reserveActiveSessionRun(sessionId, runId)).pipe(
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
          Effect.sync(initialReservation.release).pipe(Effect.zipRight(Effect.failCause(cause))),
        ),
      ),
    ),
    Effect.as(true),
  )
}

export function executeSessionLifecycleCommand(
  input: ExecuteSessionLifecycleCommandInput,
): Effect.Effect<SessionLifecycleResponse, unknown, SessionLifecycleCommandDependencies> {
  return Effect.gen(function* () {
    const mayStartRun =
      input.request.command.operation === 'launch' || input.request.command.operation === 'spawn'
    const lease = mayStartRun ? yield* acquireSessionHostRunLease('run') : undefined
    let transferred = false
    return yield* executeSessionLifecycle(input).pipe(
      Effect.tap((response) =>
        dispatchAcceptedLifecycleRun(response, lease).pipe(
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
