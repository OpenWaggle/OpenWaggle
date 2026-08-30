import { DatabaseSync } from 'node:sqlite'

interface RunRow {
  readonly session_id: string
  readonly run_id: string
}

interface OperationRow {
  readonly operation_id: string | number
  readonly operation: string
  readonly target_scope: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeRunRows(value: unknown): RunRow[] {
  if (!Array.isArray(value)) throw new Error('Session Host Run blockers query returned no rows.')
  return value.map((row) => {
    if (!isRecord(row) || typeof row.session_id !== 'string' || typeof row.run_id !== 'string') {
      throw new Error('Session Host Run blockers query returned an invalid row.')
    }
    return { session_id: row.session_id, run_id: row.run_id }
  })
}

function decodeOperationRows(value: unknown): OperationRow[] {
  if (!Array.isArray(value)) {
    throw new Error('Session Host operation blockers query returned no rows.')
  }
  return value.map((row) => {
    if (
      !isRecord(row) ||
      (typeof row.operation_id !== 'string' && typeof row.operation_id !== 'number') ||
      typeof row.operation !== 'string' ||
      typeof row.target_scope !== 'string'
    ) {
      throw new Error('Session Host operation blockers query returned an invalid row.')
    }
    return {
      operation_id: row.operation_id,
      operation: row.operation,
      target_scope: row.target_scope,
    }
  })
}

export function readSessionHostUpgradeBlockers(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const blockingRuns = decodeRunRows(
      database
        .prepare(
          `SELECT session_id, active_run_id AS run_id
         FROM session_control_states
         WHERE active_run_id IS NOT NULL
         ORDER BY session_id, active_run_id`,
        )
        .all(),
    )
    const controlOperations = decodeOperationRows(
      database
        .prepare(
          `SELECT id AS operation_id, operation, target_scope
         FROM session_operations
         WHERE status = 'pending'
         ORDER BY created_at, id`,
        )
        .all(),
    )
    const exportOperations = decodeOperationRows(
      database
        .prepare(
          `SELECT id AS operation_id, 'export' AS operation, session_id AS target_scope
         FROM session_export_operations
         WHERE status IN ('queued', 'running', 'installing', 'cancelling')
         ORDER BY created_at, id`,
        )
        .all(),
    )
    return {
      blockingRuns: blockingRuns.map((row) => ({
        sessionId: row.session_id,
        runId: row.run_id,
      })),
      blockingOperations: [...controlOperations, ...exportOperations].map((row) => ({
        operationId: String(row.operation_id),
        operation: row.operation,
        targetScope: row.target_scope,
      })),
    }
  } finally {
    database.close()
  }
}
