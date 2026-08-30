import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionHostRecoveryRepositoryError } from '../errors'
import { SessionHostRecoveryRepository } from '../ports/session-host-recovery-repository'

interface RunRow {
  readonly id: string
  readonly session_id: string
}

interface AuthorizationRequestRow {
  readonly id: string
}

interface PendingWorktreeRemovalRow {
  readonly id: string
  readonly working_path: string
}

interface PendingOperationRow {
  readonly id: number
  readonly caller_id: string
  readonly operation: string
  readonly target_scope: string
  readonly idempotency_key: string
  readonly request_json: string
  readonly status: 'pending' | 'completed'
}

const LIFECYCLE_OPERATIONS = new Set(['create', 'fork', 'launch', 'spawn'])

function hostLostOutcome(operation: PendingOperationRow) {
  return LIFECYCLE_OPERATIONS.has(operation.operation)
    ? {
        operation: operation.operation,
        effect: 'rejected',
        code: 'host_lost',
        retryable: true,
      }
    : {
        operation: operation.operation,
        effect: 'rejected',
        sessionId: operation.target_scope,
        code: 'host_lost',
      }
}

function recoverAfterHostLoss(sql: SqlClient.SqlClient, now: number) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const runs = yield* sql<RunRow>`
          SELECT id, session_id
          FROM session_runs
          WHERE status IN ('starting', 'active', 'stopping')
          ORDER BY created_at, id
        `
        const runIds = runs.map((run) => run.id)
        const authorizationRequests =
          runIds.length > 0
            ? yield* sql<AuthorizationRequestRow>`
                SELECT id
                FROM session_authorization_requests
                WHERE status = 'pending'
                  AND run_id IN ${sql.in(runIds)}
                ORDER BY created_at, id
              `
            : []
        if (runIds.length > 0) {
          yield* sql`
            UPDATE session_control_states
            SET
              active_run_id = NULL,
              queue_state = 'paused',
              state_revision = state_revision + 1,
              queue_revision = queue_revision + 1,
              updated_at = ${now}
            WHERE active_run_id IN ${sql.in(runIds)}
          `
          yield* sql`
            UPDATE session_authorization_requests
            SET
              status = 'denied',
              decision_reason = 'host_lost',
              decided_at = ${now}
            WHERE status = 'pending'
              AND run_id IN ${sql.in(runIds)}
          `
          yield* sql`
            UPDATE session_runs
            SET status = 'interrupted-by-host-loss', updated_at = ${now}
            WHERE id IN ${sql.in(runIds)}
          `
        }
        const pendingOperations = yield* sql<PendingOperationRow>`
          SELECT id, caller_id, operation, target_scope, idempotency_key, request_json, status
          FROM session_operations
          WHERE status = 'pending'
            OR (status = 'completed' AND operation = 'handoff' AND cleanup_json IS NOT NULL)
          ORDER BY created_at, id
        `
        const pendingHandoffs = pendingOperations.filter(
          (operation) => operation.operation === 'handoff',
        )
        const pendingWorktreeRemovals = yield* sql<PendingWorktreeRemovalRow>`
          SELECT resources.id, resources.working_path
          FROM workspace_resources AS resources
          WHERE resources.kind = ${'managed-worktree'}
            AND resources.lifecycle_state = ${'releasing'}
            AND NOT EXISTS (
              SELECT 1 FROM session_workspace_bindings AS bindings
              WHERE bindings.workspace_id = resources.id
            )
          ORDER BY resources.created_at, resources.id
        `
        const recoverableOperations = pendingOperations.filter(
          (operation) => operation.status === 'pending' && operation.operation !== 'handoff',
        )
        yield* Effect.forEach(
          recoverableOperations,
          (operation) =>
            sql`
            UPDATE session_operations SET
              status = ${'completed'},
              outcome_json = ${JSON.stringify(hostLostOutcome(operation))},
              updated_at = ${now}
            WHERE id = ${operation.id} AND status = ${'pending'}
          `,
        )
        return {
          interruptedRunIds: runIds,
          affectedSessionIds: [...new Set(runs.map((run) => run.session_id))],
          deniedAuthorizationRequestIds: authorizationRequests.map((request) => request.id),
          recoveredOperationIds: recoverableOperations.map((operation) => String(operation.id)),
          pendingHandoffs: pendingHandoffs.map((operation) => ({
            operationId: String(operation.id),
            callerId: operation.caller_id,
            idempotencyKey: operation.idempotency_key,
            requestJson: operation.request_json,
          })),
          pendingWorktreeRemovals: pendingWorktreeRemovals.map((removal) => ({
            resourceId: removal.id,
            workingPath: removal.working_path,
            createdReservation: removal.id.startsWith('worktree-removal:'),
          })),
        }
      }),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new SessionHostRecoveryRepositoryError({ operation: 'recover-after-host-loss', cause }),
      ),
    )
}

export const SqliteSessionHostRecoveryRepositoryLive = Layer.effect(
  SessionHostRecoveryRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionHostRecoveryRepository.of({
      recoverAfterHostLoss: (now) => recoverAfterHostLoss(sql, now),
    })
  }),
)
