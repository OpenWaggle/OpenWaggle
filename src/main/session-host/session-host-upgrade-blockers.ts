import * as SqlClient from '@effect/sql/SqlClient'
import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import * as Effect from 'effect/Effect'

const RunRow = Schema.Struct({ session_id: Schema.String, run_id: Schema.String })

const OperationRow = Schema.Struct({
  operation_id: Schema.Union(Schema.String, Schema.Number),
  operation: Schema.String,
  target_scope: Schema.String,
})

const RunRows = Schema.Array(RunRow)
const OperationRows = Schema.Array(OperationRow)

/**
 * Reads what an upgrade must wait for through the Host's own better-sqlite3 connection.
 *
 * It must not open a second connection with another SQLite library: each library bundles its own
 * SQLite, POSIX file locks belong to the process, and closing the other library's descriptor drops
 * the Host connection's locks on the live database (https://www.sqlite.org/howtocorrupt.html,
 * section 2.2.1). Every query runs in one read transaction, so the result is one snapshot.
 */
export const readSessionHostUpgradeBlockers = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const blockingRuns = decodeUnknownExactOrThrow(
        RunRows,
        yield* sql`SELECT session_id, active_run_id AS run_id
          FROM session_control_states
          WHERE active_run_id IS NOT NULL
          ORDER BY session_id, active_run_id`,
      )
      const controlOperations = decodeUnknownExactOrThrow(
        OperationRows,
        yield* sql`SELECT id AS operation_id, operation, target_scope
          FROM session_operations
          WHERE status = 'pending'
          ORDER BY created_at, id`,
      )
      const exportOperations = decodeUnknownExactOrThrow(
        OperationRows,
        yield* sql`SELECT id AS operation_id, 'export' AS operation, session_id AS target_scope
          FROM session_export_operations
          WHERE status IN ('queued', 'running', 'installing', 'cancelling')
          ORDER BY created_at, id`,
      )
      const actionOperations = decodeUnknownExactOrThrow(
        OperationRows,
        yield* sql`SELECT id AS operation_id, 'project-action' AS operation,
            workspace_id AS target_scope
          FROM project_action_runs
          WHERE status IN ('starting', 'running', 'stopping')
          ORDER BY started_at, id`,
      )
      const preparationOperations = decodeUnknownExactOrThrow(
        OperationRows,
        yield* sql`SELECT workspace_id AS operation_id, 'workspace-preparation' AS operation,
            workspace_id AS target_scope
          FROM workspace_preparation
          WHERE json_extract(state_json, '$.setup.status') = 'running'
            OR json_extract(state_json, '$.cleanup.status') = 'running'
          ORDER BY workspace_id`,
      )
      return {
        blockingRuns: blockingRuns.map((row) => ({ sessionId: row.session_id, runId: row.run_id })),
        blockingOperations: [
          ...controlOperations,
          ...exportOperations,
          ...actionOperations,
          ...preparationOperations,
        ].map((row) => ({
          operationId: String(row.operation_id),
          operation: row.operation,
          targetScope: row.target_scope,
        })),
      }
    }),
  )
})
