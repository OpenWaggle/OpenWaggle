import { RunId, type SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { SessionControlIdentityService } from '../ports/session-control-identity-service'
import {
  type SessionControlRunExecutionResult,
  SessionControlRunExecutor,
} from '../ports/session-control-run-executor'
import { SessionControlRunLifecycleRepository } from '../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import {
  type ActiveSessionRunReservation,
  hasClaimedSessionWriterSuccessor,
  reserveActiveSessionRun,
} from './active-session-runs'
import { requestHiveWorkerCleanup } from './hive-worker-cleanup-request'
import { acquireSessionHostRunLease, type SessionHostRunLease } from './session-host-run-admission'
import { takeUndeliveredSteers } from './undelivered-steering-settlement'

export interface CoordinateSessionRunsInput {
  readonly sessionId: SessionId
  readonly startingRunId: RunId
  readonly initialReservation?: ActiveSessionRunReservation
  readonly lease?: SessionHostRunLease
}

export interface CoordinatedRunResult {
  readonly runId: RunId
  readonly terminalStatus:
    | 'completed'
    | 'failed'
    | 'interrupted'
    | 'interrupted-by-interaction-timeout'
}

export function coordinateSessionRuns(input: CoordinateSessionRunsInput) {
  return Effect.gen(function* () {
    const lease = input.lease ?? (yield* acquireSessionHostRunLease('run'))
    return yield* coordinateLiveSessionRuns(input).pipe(Effect.ensuring(Effect.sync(lease.release)))
  })
}

function coordinateLiveSessionRuns(input: CoordinateSessionRunsInput) {
  return Effect.gen(function* () {
    const identities = yield* SessionControlIdentityService
    const lifecycle = yield* SessionControlRunLifecycleRepository
    const updateDelivery = yield* SessionOrchestrationUpdateDeliveryService
    const executor = yield* SessionControlRunExecutor
    const results: CoordinatedRunResult[] = []
    let runId = input.startingRunId
    let initialReservation = input.initialReservation

    while (true) {
      const reservation = initialReservation ?? reserveActiveSessionRun(input.sessionId, runId)
      initialReservation = undefined
      let settledExecution: SessionControlRunExecutionResult | undefined
      const settlement = yield* Effect.gen(function* () {
        const activation = yield* lifecycle.activate({ sessionId: input.sessionId, runId })
        if (!activation.accepted && !reservation.controller.signal.aborted) return undefined
        if (activation.accepted) {
          publishSessionHostEvent({
            kind: 'session-state-changed',
            sessionId: input.sessionId,
            stateRevision: activation.stateRevision,
            operation: 'run-activated',
          })
        }

        const execution: SessionControlRunExecutionResult = activation.accepted
          ? yield* executor
              .execute({
                sessionId: input.sessionId,
                runId,
                intent: activation.intent,
                controller: reservation.controller,
              })
              .pipe(Effect.catchAll(() => Effect.succeed({ terminalStatus: 'failed' as const })))
          : { terminalStatus: 'interrupted' as const }
        results.push({ runId, terminalStatus: execution.terminalStatus })
        settledExecution = execution

        const nextRunId = yield* identities.nextRunId
        const undeliveredSteers = yield* takeUndeliveredSteers(runId)
        return yield* lifecycle.settle({
          sessionId: input.sessionId,
          runId,
          nextRunId,
          terminalStatus: execution.terminalStatus,
          ...(execution.terminalEventAt === undefined
            ? {}
            : { terminalEventAt: execution.terminalEventAt }),
          suppressFollowUpScheduling: hasClaimedSessionWriterSuccessor(input.sessionId, runId),
          ...(execution.finalResponse ? { finalResponse: execution.finalResponse } : {}),
          ...(undeliveredSteers.length > 0 ? { undeliveredSteers } : {}),
        })
      }).pipe(Effect.ensuring(Effect.sync(reservation.release)))
      if (!settlement) return results
      if (settlement.accepted) {
        publishSessionHostEvent({
          kind: 'session-state-changed',
          sessionId: input.sessionId,
          stateRevision: settlement.stateRevision,
          operation: settlement.scheduled ? 'follow-up-started' : 'run-settled',
          // Which Run settled and how, so a client credits the completion to that Run's send.
          runId,
          ...(settledExecution
            ? {
                terminalStatus: settledExecution.terminalStatus,
                ...(settledExecution.failure ? { failureCode: settledExecution.failure.code } : {}),
              }
            : {}),
        })
        if (settlement.delegationUpdate) {
          publishSessionHostEvent({
            kind: 'session-list-changed',
            sessionId: settlement.delegationUpdate.parentSessionId,
            change: 'updated',
          })
        }
        if (settlement.orchestrationUpdate) {
          yield* updateDelivery.deliverPendingToActiveRun({
            parentSessionId: settlement.orchestrationUpdate.parentSessionId,
          })
        }
      }
      if (!settlement.accepted) return results
      if (!settlement.scheduled) {
        // Hive cleanup trigger: the Session settled with nothing scheduled. It may be a finished
        // Worker, or a parent whose accepted/cancelled Workers can now be archived.
        yield* requestHiveWorkerCleanup(input.sessionId)
        return results
      }
      runId = RunId(settlement.scheduled.runId)
    }
  })
}
