import { matchBy } from '@diegogbrisa/ts-match'
import { RunId, SessionId } from '@shared/types/brand'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type {
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import type { SessionControlIdentityService } from '../ports/session-control-identity-service'
import type { SessionControlRunExecutor } from '../ports/session-control-run-executor'
import type { SessionControlRunLifecycleRepository } from '../ports/session-control-run-lifecycle-repository'
import type { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'
import { reserveActiveSessionRun } from './active-session-runs'
import {
  executeUnserializedSessionControlCommand,
  type SessionControlCommandDependencies,
} from './session-control-command-dispatch'
import { coordinateSessionRuns } from './session-control-run-coordinator'
import { acquireSessionHostRunLease, type SessionHostRunLease } from './session-host-run-admission'
import { forkSupervisedSessionRuns } from './session-run-coordinator-supervision'

interface SessionSemaphoreEntry {
  readonly semaphore: Effect.Semaphore
  users: number
}

const sessionSemaphores = new Map<string, SessionSemaphoreEntry>()

function acquireSessionSemaphore(sessionId: string) {
  return Effect.sync(() => {
    const existing = sessionSemaphores.get(sessionId)
    if (existing) {
      existing.users += 1
      return existing
    }
    const created = { semaphore: Effect.runSync(Effect.makeSemaphore(1)), users: 1 }
    sessionSemaphores.set(sessionId, created)
    return created
  })
}

function releaseSessionSemaphore(sessionId: string, entry: SessionSemaphoreEntry) {
  return Effect.sync(() => {
    entry.users -= 1
    if (entry.users === 0 && sessionSemaphores.get(sessionId) === entry) {
      sessionSemaphores.delete(sessionId)
    }
  })
}

export function dispatchAcceptedSessionControlRun(
  response: SessionControlMutationResponse,
  lease: SessionHostRunLease | undefined,
) {
  const startingRun = matchBy(response.outcome, 'effect')
    .with('started-run', (outcome) => ({ sessionId: outcome.sessionId, runId: outcome.runId }))
    .with('replaced-run', (outcome) => ({ sessionId: outcome.sessionId, runId: outcome.runId }))
    .with(
      'queued-follow-up',
      'steered-run',
      'interruption-requested',
      'interaction-resolved',
      'authorization-updated',
      'descendant-interruptions-requested',
      'promoted-follow-up',
      'queue-updated',
      'accepted-report',
      'delegation-claims-updated',
      'delegation-conflict-acknowledged',
      'delegation-dependencies-updated',
      'delegation-amendment-proposed',
      'delegation-specification-amended',
      'delegation-verification-recorded',
      'delegation-updated',
      'export-accepted',
      'export-cancellation-requested',
      'session-renamed',
      'session-archived',
      'session-unarchived',
      'session-handed-off',
      'rejected',
      () => null,
    )
    .exhaustive()
  if (!startingRun || response.replayed) return Effect.succeed(false)
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

function commandMayStartRun(request: SessionControlMutationRequest) {
  const operation = request.command.operation
  return (
    operation === 'message' ||
    operation === 'start' ||
    operation === 'replace' ||
    operation === 'queue-resume'
  )
}

type SessionControlDispatchDependencies =
  | SessionControlIdentityService
  | SessionOrchestrationUpdateDeliveryService
  | SessionControlRunExecutor
  | SessionControlRunLifecycleRepository

export function executeSessionControlMutation(input: {
  readonly callerId: string
  readonly authority?: LocalSessionProfileAuthority
  readonly hostRunCeiling?: number
  readonly request: SessionControlMutationRequest
}): Effect.Effect<
  SessionControlMutationResponse,
  unknown,
  SessionControlCommandDependencies | SessionControlDispatchDependencies
> {
  const sessionId = input.request.command.sessionId
  return Effect.gen(function* () {
    const lease = commandMayStartRun(input.request)
      ? yield* acquireSessionHostRunLease('run')
      : undefined
    let transferred = false
    return yield* Effect.acquireUseRelease(
      acquireSessionSemaphore(sessionId),
      (entry) =>
        executeUnserializedSessionControlCommand(input).pipe(
          Effect.tap((response) =>
            dispatchAcceptedSessionControlRun(response, lease).pipe(
              Effect.tap((didTransfer) =>
                Effect.sync(() => {
                  transferred = didTransfer
                }),
              ),
            ),
          ),
          entry.semaphore.withPermits(1),
        ),
      (entry) => releaseSessionSemaphore(sessionId, entry),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!transferred) lease?.release()
        }),
      ),
    )
  })
}
