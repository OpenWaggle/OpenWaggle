import { randomUUID } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import {
  SESSION_EXPORT_GLOBAL_CONCURRENCY_LIMIT,
  SESSION_EXPORT_PROFILE_CONCURRENCY_LIMIT,
} from '@shared/types/session-export-operation'
import * as Effect from 'effect/Effect'
import {
  type SessionExportOperationRow,
  sessionExportOperationRecord,
} from './sqlite-session-export-operation-row'

export function claimExportExecution(sql: SqlClient.SqlClient, operationId: string, now: number) {
  const executionToken = randomUUID()
  return sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        UPDATE session_export_operations
        SET status = ${'running'}, execution_token = ${executionToken}, updated_at = ${now}
        WHERE id = ${operationId} AND status = ${'queued'} AND cancel_requested = ${0}
          AND (
            SELECT COUNT(*) FROM session_export_operations AS active
            WHERE active.status IN (${'running'}, ${'installing'}, ${'cancelling'})
          ) < ${SESSION_EXPORT_GLOBAL_CONCURRENCY_LIMIT}
          AND (
            origin_profile_id IS NULL OR (
              SELECT COUNT(*) FROM session_export_operations AS active
              WHERE active.origin_profile_id = session_export_operations.origin_profile_id
                AND active.status IN (${'running'}, ${'installing'}, ${'cancelling'})
            ) < ${SESSION_EXPORT_PROFILE_CONCURRENCY_LIMIT}
          )
      `
      const rows = yield* sql<SessionExportOperationRow>`
        SELECT * FROM session_export_operations WHERE id = ${operationId} LIMIT 1
      `
      const row = rows[0]
      const operation = row ? sessionExportOperationRecord(row) : null
      return row?.execution_token === executionToken && operation
        ? ({ status: 'claimed', operation } as const)
        : ({ status: 'not-claimable', ...(operation ? { operation } : {}) } as const)
    }),
  )
}

export function claimNextExportExecution(sql: SqlClient.SqlClient, now: number) {
  const executionToken = randomUUID()
  return sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        UPDATE session_export_operations
        SET status = ${'running'}, execution_token = ${executionToken}, updated_at = ${now}
        WHERE id = (
          SELECT candidate.id
          FROM session_export_operations AS candidate
          WHERE candidate.status = ${'queued'} AND candidate.cancel_requested = ${0}
            AND (
              SELECT COUNT(*) FROM session_export_operations AS active
              WHERE active.status IN (${'running'}, ${'installing'}, ${'cancelling'})
            ) < ${SESSION_EXPORT_GLOBAL_CONCURRENCY_LIMIT}
            AND (
              candidate.origin_profile_id IS NULL OR (
                SELECT COUNT(*) FROM session_export_operations AS active
                WHERE active.origin_profile_id = candidate.origin_profile_id
                  AND active.status IN (${'running'}, ${'installing'}, ${'cancelling'})
              ) < ${SESSION_EXPORT_PROFILE_CONCURRENCY_LIMIT}
            )
          ORDER BY candidate.created_at, candidate.id
          LIMIT 1
        )
          AND status = ${'queued'} AND cancel_requested = ${0}
      `
      const rows = yield* sql<SessionExportOperationRow>`
        SELECT * FROM session_export_operations WHERE execution_token = ${executionToken} LIMIT 1
      `
      const row = rows[0]
      return row
        ? ({ status: 'claimed', operation: sessionExportOperationRecord(row) } as const)
        : ({ status: 'not-claimable' } as const)
    }),
  )
}
