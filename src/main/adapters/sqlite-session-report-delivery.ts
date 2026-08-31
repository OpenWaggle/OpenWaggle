import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SessionControlRepositoryError } from '../errors'
import type { PendingSessionReport } from '../ports/session-report-repository'

function deliveryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

export function listPendingReports(sql: SqlClient.SqlClient, targetSessionId: string) {
  return sql<{
    report_id: string
    correlation_id: string
    reply_to_report_id: string | null
    source_session_id: string
    source_run_id: string | null
    authored_by: string
    content: string
    request_reply: number
    created_at: number
  }>`
    SELECT reports.id AS report_id, reports.correlation_id, reports.reply_to_report_id,
      reports.source_session_id, reports.source_run_id, reports.authored_by, reports.content,
      reports.request_reply, reports.created_at
    FROM cross_session_report_deliveries AS deliveries
    JOIN cross_session_reports AS reports ON reports.id = deliveries.report_id
    WHERE deliveries.target_session_id = ${targetSessionId} AND deliveries.status = ${'pending'}
    ORDER BY reports.created_at, reports.id
  `.pipe(
    Effect.map((rows): readonly PendingSessionReport[] =>
      rows.map((row) => ({
        reportId: row.report_id,
        correlationId: row.correlation_id,
        ...(row.reply_to_report_id ? { replyToReportId: row.reply_to_report_id } : {}),
        sourceSessionId: row.source_session_id,
        ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
        authoredBy: row.authored_by,
        content: row.content,
        requestReply: row.request_reply === 1,
        createdAt: row.created_at,
      })),
    ),
  )
}

export function markReportsDelivered(
  sql: SqlClient.SqlClient,
  input: {
    readonly reportIds: readonly string[]
    readonly targetSessionId: string
    readonly runId: string
    readonly itemIds: readonly string[]
    readonly deliveredAt: number
  },
) {
  return Effect.gen(function* () {
    if (input.reportIds.length !== input.itemIds.length) {
      return yield* Effect.fail(deliveryError('mark-delivered-identity-count-mismatch', input))
    }
    yield* sql.withTransaction(
      Effect.forEach(
        input.reportIds,
        (reportId, index) => sql`
          UPDATE cross_session_report_deliveries
          SET status = ${'delivered'}, delivered_run_id = ${input.runId},
            delivered_item_id = ${input.itemIds[index]}, delivered_at = ${input.deliveredAt}
          WHERE report_id = ${reportId} AND target_session_id = ${input.targetSessionId}
            AND status = ${'pending'}
        `,
        { discard: true },
      ),
    )
  })
}
