import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { waitsOnHeldNextFollowUp } from '../domain/session-control/follow-up-delivery'
import {
  activateStartingRun,
  startExternalSessionRun,
} from '../domain/session-control/run-lifecycle'
import { returnUndeliveredSteersReportingDrops } from '../domain/session-control/undelivered-steering'
import { SessionControlRepositoryError } from '../errors'
import {
  SessionControlRunLifecycleRepository,
  type SessionControlRunLifecycleRepositoryShape,
} from '../ports/session-control-run-lifecycle-repository'
import { reportDroppedReturnedSteers } from './returned-steer-drop-report'
import { releaseDeliveredSteerAttachments } from './session-control-attachment-references'
import { applyCurrentFollowUpAuthorization } from './session-follow-up-authorization'
import {
  deferWorkerSettlement,
  settleDeferredWorkerDelegation,
  takeDeferredWorkerSettlement,
} from './sqlite-deferred-worker-settlement'
import {
  externalRunAdmission,
  replaceWithExternal,
} from './sqlite-session-control-external-run-replacement'
import { recoverSessionControlHostLoss } from './sqlite-session-control-host-loss-recovery'
import {
  planRunSettlement,
  replacementIsPending,
  type SettleInput,
  settleDisplacedRun,
} from './sqlite-session-control-run-settlement'
import { loadSessionControlState, persistSessionControlState } from './sqlite-session-control-state'
import { settleWorkerDelegation } from './sqlite-session-control-worker-settlement'
import { reservedFollowUpIds } from './sqlite-session-follow-up-reservation'
import { directWorkerRunAdmission } from './sqlite-session-parent-run-admission'

const PROMOTION_SETTLEMENT_RETRY_DELAY_MS = 100
const PROMOTION_SETTLEMENT_RETRY_LIMIT = 10

function repositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

function settledRunResponse(
  result: Extract<ReturnType<typeof planRunSettlement>, { readonly accepted: true }>,
  workerUpdate: Effect.Effect.Success<ReturnType<typeof settleWorkerDelegation>>,
) {
  const { scheduled } = result
  return {
    status: 'settled',
    result: {
      accepted: true,
      stateRevision: result.state.revision,
      ...(scheduled ? { scheduled } : {}),
      ...(workerUpdate?.delegationUpdate
        ? { delegationUpdate: workerUpdate.delegationUpdate }
        : {}),
      ...(workerUpdate?.orchestrationUpdate
        ? { orchestrationUpdate: workerUpdate.orchestrationUpdate }
        : {}),
    },
  } as const
}

function activate(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionControlRunLifecycleRepositoryShape['activate']>[0],
) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const state = yield* loadSessionControlState(sql, input.sessionId)
        const result = activateStartingRun(state, input.runId)
        if (!result.accepted) return result
        if (state.run.state !== 'starting') {
          throw new Error('Accepted Run activation did not originate from a starting Run.')
        }
        const now = Date.now()
        yield* persistSessionControlState(sql, result.state, now)
        return {
          accepted: true,
          stateRevision: result.state.revision,
          intent: state.run.intent,
        } as const
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('activate-run', cause),
      ),
    )
}

function startExternal(
  sql: SqlClient.SqlClient,
  input: Parameters<NonNullable<SessionControlRunLifecycleRepositoryShape['startExternal']>>[0],
) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const state = yield* loadSessionControlState(sql, input.sessionId)
        const started = startExternalSessionRun(state, input.runId, input.intent)
        if (!started.accepted) return started
        const admission = yield* externalRunAdmission(sql, input)
        if (admission) return admission
        yield* persistSessionControlState(sql, started.state, Date.now())
        const activated = activateStartingRun(started.state, input.runId)
        if (!activated.accepted) return activated
        yield* persistSessionControlState(sql, activated.state, Date.now())
        return {
          accepted: true,
          stateRevision: activated.state.revision,
          intent: input.intent,
        } as const
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('start-external-run', cause),
      ),
    )
}

function settle(
  sql: SqlClient.SqlClient,
  input: SettleInput,
  promotionRetriesRemaining = PROMOTION_SETTLEMENT_RETRY_LIMIT,
): ReturnType<SessionControlRunLifecycleRepositoryShape['settle']> {
  let droppedSteers: ReturnType<typeof returnUndeliveredSteersReportingDrops>['dropped'] = []
  return sql
    .withTransaction(
      Effect.gen(function* () {
        // A promotion may already have delivered its steering side effect while its journal
        // completion is still in flight. Never expire that reservation by wall-clock age: doing
        // so can schedule the same Follow-up twice. Host-loss recovery is the safe fencing point
        // because the process that owned every pending side effect is known to be gone.
        const reservedIds = yield* reservedFollowUpIds(sql, input.sessionId)
        if (reservedIds.size > 0) return { status: 'promotion-pending' } as const
        const loadedState = yield* loadSessionControlState(sql, input.sessionId)
        const steerReturn = returnUndeliveredSteersReportingDrops(
          loadedState,
          input.undeliveredSteers ?? [],
        )
        const returned = steerReturn.state
        droppedSteers = steerReturn.dropped
        const state = yield* applyCurrentFollowUpAuthorization(sql, returned)
        const replacementPending = yield* replacementIsPending(sql, state, input)
        if (replacementPending) {
          return {
            status: 'settled',
            result: yield* settleDisplacedRun(sql, { loadedState, returned, input }),
          } as const
        }
        const parentAdmission = input.suppressFollowUpScheduling
          ? { admitted: true }
          : yield* directWorkerRunAdmission(sql, input.sessionId)
        const deferForParentLimit = !parentAdmission.admitted
        const result = planRunSettlement(state, input, deferForParentLimit)
        if (!result.accepted) {
          return {
            status: 'settled',
            result: yield* settleDisplacedRun(sql, {
              loadedState,
              returned,
              input,
              code: result.code,
            }),
          } as const
        }
        const { scheduled } = result
        const now = Date.now()
        yield* sql`
          UPDATE session_runs
          SET status = ${input.terminalStatus}, updated_at = ${now}
          WHERE id = ${input.runId} AND session_id = ${input.sessionId}
        `
        // A newer settlement supersedes a Delegation settlement an edit deferred.
        yield* takeDeferredWorkerSettlement(sql, input.sessionId)
        // The queue's next Follow-up is out for an edit and is delivered once the edit ends, so the
        // Worker is not done yet: its Delegation settles after that Run, or when the edit ends
        // without one (see `settleDeferredWorkerDelegation`).
        const waitsOnEdit = scheduled === undefined && waitsOnHeldNextFollowUp(result.state)
        const workerUpdate = input.suppressFollowUpScheduling
          ? undefined
          : yield* settleWorkerDelegation(sql, input, scheduled !== undefined || waitsOnEdit, now)
        if (
          !input.suppressFollowUpScheduling &&
          waitsOnEdit &&
          input.terminalStatus === 'completed'
        ) {
          yield* deferWorkerSettlement(sql, input.sessionId, {
            runId: input.runId,
            ...(input.finalResponse ? { finalResponse: input.finalResponse } : {}),
          })
        }
        yield* persistSessionControlState(sql, result.state, now)
        yield* releaseDeliveredSteerAttachments(sql, input)
        return settledRunResponse(result, workerUpdate)
      }),
    )
    .pipe(
      Effect.flatMap((outcome) =>
        outcome.status === 'settled'
          ? reportDroppedReturnedSteers(input, droppedSteers).pipe(Effect.as(outcome.result))
          : promotionRetriesRemaining <= 0
            ? Effect.fail(
                repositoryError('settle-run-promotion-pending', {
                  runId: input.runId,
                  sessionId: input.sessionId,
                }),
              )
            : Effect.sleep(PROMOTION_SETTLEMENT_RETRY_DELAY_MS).pipe(
                Effect.zipRight(settle(sql, input, promotionRetriesRemaining - 1)),
              ),
      ),
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('settle-run', cause),
      ),
    )
}

export const SqliteSessionControlRunLifecycleRepositoryLive = Layer.effect(
  SessionControlRunLifecycleRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionControlRunLifecycleRepository.of({
      startExternal: (input) => startExternal(sql, input),
      replaceWithExternal: (input) => replaceWithExternal(sql, input),
      activate: (input) => activate(sql, input),
      settle: (input) => settle(sql, input),
      settleDeferredWorkerDelegation: (input) =>
        settleDeferredWorkerDelegation(sql, input.sessionId),
      recoverHostLoss: recoverSessionControlHostLoss(sql),
    })
  }),
)
