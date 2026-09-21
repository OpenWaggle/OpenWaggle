import type * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import type { SessionControlMutationCommand } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { recoverSessionAfterHostLoss } from '../domain/session-control/run-lifecycle'
import { SessionControlRepositoryError } from '../errors'
import { loadSessionControlState, persistSessionControlState } from './sqlite-session-control-state'

interface ActiveStateRow {
  readonly session_id: string
  readonly active_run_id: string
}

interface PendingOperationRow {
  readonly id: number
  readonly operation: SessionControlMutationCommand['operation'] | 'waggle'
  readonly target_scope: string
}

export function recoverSessionControlHostLoss(sql: SqlClient.SqlClient) {
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
          const outcome = JSON.stringify(
            operation.operation === 'waggle'
              ? {
                  outcome: 'cancelled',
                  message: 'The Session Host stopped before the Waggle outcome was confirmed.',
                  code: 'host_lost',
                }
              : {
                  operation: operation.operation,
                  effect: 'rejected',
                  sessionId: operation.target_scope,
                  code: 'host_lost',
                },
          )
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
          : new SessionControlRepositoryError({ operation: 'recover-host-loss', cause }),
      ),
    )
}
