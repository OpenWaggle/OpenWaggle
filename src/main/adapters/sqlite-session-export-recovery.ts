import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  type SessionExportOperationRow,
  sessionExportOperationRecord,
} from './sqlite-session-export-operation-row'

export const SESSION_EXPORT_RECOVERY_PAGE_SIZE = 32

export function makeExportHostLossRecovery(sql: SqlClient.SqlClient) {
  let pending = false
  let highWaterRowId = 0
  let afterRowId = 0
  let pageEndRowId: number | undefined

  const begin = Effect.gen(function* () {
    pending = true
    afterRowId = 0
    pageEndRowId = undefined
    const rows = yield* sql<{ readonly high_water_row_id: number }>`
      SELECT COALESCE(MAX(rowid), 0) AS high_water_row_id FROM session_export_operations
    `
    highWaterRowId = rows[0]?.high_water_row_id ?? 0
  })

  function readPage(now: number) {
    return sql.withTransaction(
      Effect.gen(function* () {
        if (!pending) return []
        // Bound source rows as well as hydrated records, including histories of terminal exports.
        const page = yield* sql<{ readonly recovery_row_id: number }>`
          SELECT rowid AS recovery_row_id FROM session_export_operations
          WHERE rowid > ${afterRowId} AND rowid <= ${highWaterRowId}
          ORDER BY rowid LIMIT ${SESSION_EXPORT_RECOVERY_PAGE_SIZE}
        `
        const endRowId = page.at(-1)?.recovery_row_id ?? highWaterRowId
        yield* sql`
          UPDATE session_export_operations NOT INDEXED
          SET status = ${'cancelled'}, execution_token = ${null},
            cleanup_pending = ${1}, updated_at = ${now}, completed_at = ${now}
          WHERE rowid > ${afterRowId} AND rowid <= ${endRowId}
            AND status IN (${'queued'}, ${'running'}, ${'cancelling'})
            AND cancel_requested = ${1}
        `
        yield* sql`
          UPDATE session_export_operations NOT INDEXED
          SET status = ${'queued'}, execution_token = ${null}, updated_at = ${now}
          WHERE rowid > ${afterRowId} AND rowid <= ${endRowId}
            AND status IN (${'running'}, ${'installing'}) AND cancel_requested = ${0}
        `
        const rows = yield* sql<SessionExportOperationRow>`
          SELECT * FROM session_export_operations NOT INDEXED
          WHERE rowid > ${afterRowId} AND rowid <= ${endRowId}
            AND (status = ${'queued'} OR cleanup_pending = ${1})
          ORDER BY rowid LIMIT ${SESSION_EXPORT_RECOVERY_PAGE_SIZE}
        `
        pageEndRowId = endRowId
        return rows.map(sessionExportOperationRecord)
      }),
    )
  }

  const completePage = Effect.sync(() => {
    if (pageEndRowId === undefined) return
    afterRowId = pageEndRowId
    pageEndRowId = undefined
    pending = afterRowId < highWaterRowId
  })

  return { begin, readPage, completePage, isPending: () => pending }
}
