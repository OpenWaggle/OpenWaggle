import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  activateStartingRun,
  replaceWithExternalSessionRun,
  startExternalSessionRun,
} from '../domain/session-control/run-lifecycle'
import { SessionControlRepositoryError } from '../errors'
import {
  SessionControlRunLifecycleRepository,
  type SessionControlRunLifecycleRepositoryShape,
} from '../ports/session-control-run-lifecycle-repository'
import { applyCurrentFollowUpAuthorization } from './session-follow-up-authorization'
import { recoverSessionControlHostLoss } from './sqlite-session-control-host-loss-recovery'
import {
  planRunSettlement,
  replacementIsPending,
  type SettleInput,
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

function externalRunAdmission(
  sql: SqlClient.SqlClient,
  input: { readonly sessionId: SessionId; readonly hostRunCeiling?: number },
) {
  return Effect.gen(function* () {
    const parentAdmission = yield* directWorkerRunAdmission(sql, input.sessionId)
    if (!parentAdmission.admitted) {
      return { accepted: false, code: 'parent_concurrency_limit_reached' } as const
    }
    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM session_control_states
      WHERE active_run_id IS NOT NULL
    `
    const hostRunCeiling = input.hostRunCeiling ?? DEFAULT_SETTINGS.sessionHostRunCeiling
    return (rows[0]?.count ?? 0) >= hostRunCeiling
      ? ({ accepted: false, code: 'host_run_ceiling_reached' } as const)
      : undefined
  })
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

function replaceWithExternal(
  sql: SqlClient.SqlClient,
  input: Parameters<
    NonNullable<SessionControlRunLifecycleRepositoryShape['replaceWithExternal']>
  >[0],
) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const state = yield* loadSessionControlState(sql, input.sessionId)
        const replaced = replaceWithExternalSessionRun(
          state,
          input.previousRunId,
          input.runId,
          input.intent,
        )
        if (!replaced.accepted) return replaced
        if (state.run.state === 'idle') {
          const admission = yield* externalRunAdmission(sql, input)
          if (admission) return admission
        }
        const now = Date.now()
        if (state.run.state !== 'idle') {
          yield* sql`
            UPDATE session_runs SET status = ${'interrupted'}, updated_at = ${now}
            WHERE id = ${state.run.runId} AND session_id = ${input.sessionId}
          `
        }
        yield* persistSessionControlState(sql, replaced.state, now)
        return {
          accepted: true,
          stateRevision: replaced.state.revision,
          intent: input.intent,
        } as const
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('replace-with-external-run', cause),
      ),
    )
}

function settle(
  sql: SqlClient.SqlClient,
  input: SettleInput,
  promotionRetriesRemaining = PROMOTION_SETTLEMENT_RETRY_LIMIT,
): ReturnType<SessionControlRunLifecycleRepositoryShape['settle']> {
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
        const state = yield* applyCurrentFollowUpAuthorization(sql, loadedState)
        const replacementPending = yield* replacementIsPending(sql, state, input)
        if (replacementPending) {
          return {
            status: 'settled',
            result: { accepted: false, code: 'run_not_active' },
          } as const
        }
        const parentAdmission = input.suppressFollowUpScheduling
          ? { admitted: true }
          : yield* directWorkerRunAdmission(sql, input.sessionId)
        const deferForParentLimit = !parentAdmission.admitted
        const result = planRunSettlement(state, input, deferForParentLimit)
        if (!result.accepted) return { status: 'settled', result } as const
        const { scheduled } = result
        const now = Date.now()
        yield* sql`
          UPDATE session_runs
          SET status = ${input.terminalStatus}, updated_at = ${now}
          WHERE id = ${input.runId} AND session_id = ${input.sessionId}
        `
        const workerUpdate = input.suppressFollowUpScheduling
          ? undefined
          : yield* settleWorkerDelegation(sql, input, scheduled !== undefined, now)
        yield* persistSessionControlState(sql, result.state, now)
        return settledRunResponse(result, workerUpdate)
      }),
    )
    .pipe(
      Effect.flatMap((outcome) =>
        outcome.status === 'settled'
          ? Effect.succeed(outcome.result)
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
      recoverHostLoss: recoverSessionControlHostLoss(sql),
    })
  }),
)
