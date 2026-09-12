import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'

export function persistExportArtifactPreparation(
  sql: SqlClient.SqlClient,
  operationId: string,
  receipt: { readonly sha256: string; readonly sizeBytes: number },
  now: number,
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        UPDATE session_export_operations
        SET artifact_sha256 = ${receipt.sha256}, artifact_size_bytes = ${receipt.sizeBytes},
          updated_at = ${now}
        WHERE id = ${operationId} AND status = ${'running'} AND cancel_requested = ${0}
      `
      const rows = yield* sql<{
        readonly artifact_sha256: string | null
        readonly artifact_size_bytes: number | null
      }>`
        SELECT artifact_sha256, artifact_size_bytes
        FROM session_export_operations
        WHERE id = ${operationId} AND status = ${'running'} AND cancel_requested = ${0}
        LIMIT 1
      `
      const recorded = rows[0]
      if (
        recorded?.artifact_sha256 !== receipt.sha256 ||
        recorded.artifact_size_bytes !== receipt.sizeBytes
      ) {
        throw new Error('Export artifact preparation was not durably recorded.')
      }
    }),
  )
}

export function clearExportArtifactPreparation(
  sql: SqlClient.SqlClient,
  operationId: string,
  now: number,
) {
  return sql`
    UPDATE session_export_operations
    SET artifact_sha256 = ${null}, artifact_size_bytes = ${null}, updated_at = ${now}
    WHERE id = ${operationId} AND status = ${'queued'}
  `.pipe(Effect.asVoid)
}

export function beginExportArtifactInstallation(
  sql: SqlClient.SqlClient,
  operationId: string,
  now: number,
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        UPDATE session_export_operations
        SET status = ${'installing'}, updated_at = ${now}
        WHERE id = ${operationId} AND status = ${'running'} AND cancel_requested = ${0}
          AND artifact_sha256 IS NOT NULL AND artifact_size_bytes IS NOT NULL
      `
      const rows = yield* sql<{ readonly status: string }>`
        SELECT status FROM session_export_operations WHERE id = ${operationId} LIMIT 1
      `
      return rows[0]?.status === 'installing'
    }),
  )
}
