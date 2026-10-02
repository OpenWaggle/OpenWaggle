import { matchBy } from '@diegogbrisa/ts-match'
import { RunId, SessionId } from '@shared/types/brand'
import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileAuthority,
} from '@shared/types/local-session-profile'
import type {
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import type { SessionControlIdentityService } from '../ports/session-control-identity-service'
import type { SessionControlRunExecutor } from '../ports/session-control-run-executor'
import type { SessionControlRunLifecycleRepository } from '../ports/session-control-run-lifecycle-repository'
import type { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'
import {
  claimSessionWriterSuccessor,
  releaseClaimedSessionWriterSuccessor,
  reserveActiveSessionRun,
  reservePendingClassicSessionRun,
} from './active-session-runs'
import {
  requestCleanupAfterDeferredWorkerSettlement,
  settleDeferredWorkerDelegationAfterQueueChange,
} from './follow-up-edit-worker-settlement'
import { restoreHiveWorkerAfterCommand } from './hive-worker-cleanup-request'
import { withSessionCommandSerialization } from './session-command-serialization'
import {
  executeUnserializedSessionControlCommand,
  type SessionControlCommandDependencies,
} from './session-control-command-dispatch'
import { coordinateSessionRuns } from './session-control-run-coordinator'
import { acquireSessionHostRunLease, type SessionHostRunLease } from './session-host-run-admission'
import { forkSupervisedSessionRuns } from './session-run-coordinator-supervision'

function waitForWriterOrCancellation(settled: Promise<void>, signal: AbortSignal) {
  return Effect.async<void>((resume) => {
    const finish = () => resume(Effect.void)
    signal.addEventListener('abort', finish, { once: true })
    void settled.then(finish)
    if (signal.aborted) finish()
    return Effect.sync(() => signal.removeEventListener('abort', finish))
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
      'follow-up-edit-held',
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
  return Effect.sync(() => claimSessionWriterSuccessor(sessionId, 'classic')).pipe(
    Effect.flatMap((successor) => {
      if (!successor) {
        const initialReservation = reserveActiveSessionRun(sessionId, runId)
        return forkSupervisedSessionRuns({
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
        )
      }

      const pending = reservePendingClassicSessionRun(sessionId, runId)
      let successorConsumed = false
      let coordinatorOwnsLease = false
      const coordinateAfterWriter = waitForWriterOrCancellation(
        successor.settled,
        pending.controller.signal,
      ).pipe(
        Effect.flatMap(() =>
          Effect.sync(() => {
            if (pending.controller.signal.aborted) {
              releaseClaimedSessionWriterSuccessor(sessionId, successor.token)
              return pending
            }
            const reservation = reserveActiveSessionRun(sessionId, runId, successor.token)
            successorConsumed = true
            pending.release()
            return reservation
          }),
        ),
        Effect.flatMap((initialReservation) => {
          coordinatorOwnsLease = true
          return coordinateSessionRuns({
            sessionId,
            startingRunId: runId,
            initialReservation,
            ...(lease ? { lease } : {}),
          })
        }),
        Effect.ensuring(
          Effect.sync(() => {
            pending.release()
            if (!successorConsumed) {
              releaseClaimedSessionWriterSuccessor(sessionId, successor.token)
            }
            if (lease && !coordinatorOwnsLease) lease.release()
          }),
        ),
      )
      return forkSupervisedSessionRuns({ sessionId, runId, effect: coordinateAfterWriter })
    }),
    Effect.as(true),
  )
}

/** Commands whose purpose is to start a Run: without a Run lease they are refused. */
function commandStartsRun(request: SessionControlMutationRequest) {
  const operation = request.command.operation
  return (
    operation === 'message' ||
    operation === 'start' ||
    operation === 'follow-up' ||
    operation === 'replace' ||
    operation === 'queue-resume'
  )
}

/**
 * Queue changes that can let an idle Session's queue deliver (`deliverIdleQueueHead`). While the
 * Host drains there is no Run lease: they still apply, without starting the next Follow-up, so a
 * window closing or a lease expiring during a drain releases its hold (Host restart recovery
 * pauses whatever queue is left runnable).
 */
function commandMayDeliverQueue(request: SessionControlMutationRequest) {
  const operation = request.command.operation
  return (
    operation === 'queue-withdraw' ||
    operation === 'queue-reorder' ||
    operation === 'queue-adopt' ||
    operation === 'queue-edit-save' ||
    operation === 'queue-edit-cancel'
  )
}

function acquireRunLease(request: SessionControlMutationRequest) {
  if (commandStartsRun(request)) return acquireSessionHostRunLease('run')
  if (!commandMayDeliverQueue(request)) return Effect.succeed(undefined)
  return acquireSessionHostRunLease('run').pipe(Effect.catchAll(() => Effect.succeed(undefined)))
}

type SessionControlDispatchDependencies =
  | SessionControlIdentityService
  | SessionOrchestrationUpdateDeliveryService
  | SessionControlRunExecutor
  | SessionControlRunLifecycleRepository

export function isSessionControlInterruption(command: SessionControlMutationRequest['command']) {
  return command.operation === 'interrupt' || command.operation === 'interrupt-descendants'
}

export function executeSessionControlMutation(input: {
  readonly callerId: string
  readonly caller?: LocalSessionCallerIdentity
  readonly authority?: LocalSessionProfileAuthority
  readonly hostRunCeiling?: number
  readonly request: SessionControlMutationRequest
}): Effect.Effect<
  SessionControlMutationResponse,
  unknown,
  SessionControlCommandDependencies | SessionControlDispatchDependencies
> {
  if (isSessionControlInterruption(input.request.command)) {
    return executeUnserializedSessionControlCommand(input)
  }
  const sessionId = input.request.command.sessionId
  return Effect.gen(function* () {
    const lease = yield* acquireRunLease(input.request)
    const queueDeliveryAdmitted = !commandMayDeliverQueue(input.request) || lease !== undefined
    let transferred = false
    let workerCleanupDue = false
    const response = yield* withSessionCommandSerialization(
      sessionId,
      executeUnserializedSessionControlCommand({
        ...input,
        ...(queueDeliveryAdmitted ? {} : { queueDeliveryAdmitted: false }),
      }).pipe(
        Effect.tap((response) =>
          restoreHiveWorkerAfterCommand({
            callerId: input.callerId,
            request: input.request,
            response,
          }),
        ),
        Effect.tap((response) =>
          dispatchAcceptedSessionControlRun(response, lease).pipe(
            Effect.tap((didTransfer) =>
              Effect.sync(() => {
                transferred = didTransfer
              }),
            ),
          ),
        ),
        Effect.tap((response) =>
          settleDeferredWorkerDelegationAfterQueueChange(input.request, response).pipe(
            Effect.tap((due) =>
              Effect.sync(() => {
                workerCleanupDue = due
              }),
            ),
          ),
        ),
      ),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!transferred) lease?.release()
        }),
      ),
    )
    // Outside the serialization: an inline cleanup pass takes the Worker's serialization itself.
    if (workerCleanupDue) yield* requestCleanupAfterDeferredWorkerSettlement(sessionId)
    return response
  })
}
