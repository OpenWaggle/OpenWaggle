import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import type { SessionControlMutationCommand } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  activateStartingRun,
  recoverSessionAfterHostLoss,
  replaceWithExternalSessionRun,
  startExternalSessionRun,
} from '../domain/session-control/run-lifecycle'
import { SessionControlRepositoryError } from '../errors'
import {
  SessionControlRunLifecycleRepository,
  type SessionControlRunLifecycleRepositoryShape,
} from '../ports/session-control-run-lifecycle-repository'
import { applyCurrentFollowUpAuthorization } from './session-follow-up-authorization'
import {
  planRunSettlement,
  replacementIsPending,
  type SettleInput,
} from './sqlite-session-control-run-settlement'
import { loadSessionControlState, persistSessionControlState } from './sqlite-session-control-state'
import { settleWorkerDelegation } from './sqlite-session-control-worker-settlement'
import { reservedFollowUpIds } from './sqlite-session-follow-up-reservation'
import { directWorkerRunAdmission } from './sqlite-session-parent-run-admission'

interface ActiveStateRow {
  readonly session_id: string
  readonly active_run_id: string
}

interface PendingOperationRow {
  readonly id: number
  readonly operation: SessionControlMutationCommand['operation']
  readonly target_scope: string
}

const PROMOTION_SETTLEMENT_RETRY_DELAY_MS = 100

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
          : Effect.sleep(PROMOTION_SETTLEMENT_RETRY_DELAY_MS).pipe(
              Effect.zipRight(settle(sql, input)),
            ),
      ),
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('settle-run', cause),
      ),
    )
}

function recoverHostLoss(sql: SqlClient.SqlClient) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const rows = yield* sql<ActiveStateRow>`
          SELECT session_id, active_run_id
          FROM session_control_states
          WHERE active_run_id IS NOT NULL
          ORDER BY session_id ASC
        `
        const now = Date.now()
        for (const row of rows) {
          const state = yield* loadSessionControlState(sql, row.session_id)
          const recovered = recoverSessionAfterHostLoss(state)
          yield* sql`
            UPDATE session_runs
            SET status = ${'interrupted-by-host-loss'}, updated_at = ${now}
            WHERE id = ${row.active_run_id} AND session_id = ${row.session_id}
          `
          yield* persistSessionControlState(sql, recovered, now)
        }

        const pendingOperations = yield* sql<PendingOperationRow>`
          SELECT id, operation, target_scope
          FROM session_operations
          WHERE status = ${'pending'}
          ORDER BY id ASC
        `
        for (const operation of pendingOperations) {
          const outcome = JSON.stringify({
            operation: operation.operation,
            effect: 'rejected',
            sessionId: operation.target_scope,
            code: 'host_lost',
          })
          yield* sql`
            UPDATE session_operations
            SET status = ${'completed'}, outcome_json = ${outcome}, updated_at = ${now}
            WHERE id = ${operation.id} AND status = ${'pending'}
          `
        }

        return rows.map((row) => ({
          sessionId: SessionId(row.session_id),
          runId: RunId(row.active_run_id),
        }))
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('recover-host-loss', cause),
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
      recoverHostLoss: recoverHostLoss(sql),
    })
  }),
)
