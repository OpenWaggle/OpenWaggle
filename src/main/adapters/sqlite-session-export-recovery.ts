import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  type SessionExportOperationRow,
  sessionExportOperationRecord,
} from './sqlite-session-export-operation-row'

export function recoverExportOperationsAfterHostLoss(sql: SqlClient.SqlClient, now: number) {
  return sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        UPDATE session_export_operations
        SET status = ${'cancelled'}, execution_token = ${null},
          cleanup_pending = ${1}, updated_at = ${now}, completed_at = ${now}
        WHERE status IN (${'running'}, ${'cancelling'}) AND cancel_requested = ${1}
      `
      yield* sql`
        UPDATE session_export_operations
        SET status = ${'queued'}, execution_token = ${null}, updated_at = ${now}
        WHERE status IN (${'running'}, ${'installing'}) AND cancel_requested = ${0}
      `
      const rows = yield* sql<SessionExportOperationRow>`
        SELECT * FROM session_export_operations
        WHERE status = ${'queued'} AND cancel_requested = ${0}
        ORDER BY created_at, id
      `
      return rows.map(sessionExportOperationRecord)
    }),
  )
}
