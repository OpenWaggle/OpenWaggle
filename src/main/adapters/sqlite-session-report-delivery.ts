import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionReportWaitObservation, SessionWaitTarget } from '@shared/types/session-wait'
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

export function observeReportWaitCondition(
  sql: SqlClient.SqlClient,
  target: Extract<
    SessionWaitTarget,
    { readonly condition: 'report-delivered' | 'correlated-reply' }
  >,
) {
  if (target.condition === 'report-delivered') {
    return sql<{
      status: 'pending' | 'delivered'
      delivered_run_id: string | null
      delivered_at: number | null
    }>`
      SELECT status, delivered_run_id, delivered_at
      FROM cross_session_report_deliveries
      WHERE report_id = ${target.reportId}
        AND target_session_id = ${target.sessionId}
      LIMIT 1
    `.pipe(
      Effect.map((rows): SessionReportWaitObservation => {
        const row = rows[0]
        return {
          condition: 'report-delivered',
          reportId: target.reportId,
          deliveryStatus: row?.status ?? 'not-found',
          ...(row?.delivered_run_id ? { deliveredRunId: row.delivered_run_id } : {}),
          ...(row?.delivered_at !== null && row?.delivered_at !== undefined
            ? { deliveredAt: row.delivered_at }
            : {}),
        }
      }),
    )
  }

  return sql<{
    report_id: string
    reply_to_report_id: string
    source_session_id: string
    created_at: number
  }>`
    SELECT reports.id AS report_id, reports.reply_to_report_id,
      reports.source_session_id, reports.created_at
    FROM cross_session_reports AS reports
    JOIN cross_session_report_deliveries AS deliveries
      ON deliveries.report_id = reports.id
    WHERE reports.correlation_id = ${target.correlationId}
      AND reports.reply_to_report_id IS NOT NULL
      AND deliveries.target_session_id = ${target.sessionId}
    ORDER BY reports.created_at, reports.id
    LIMIT 1
  `.pipe(
    Effect.map((rows): SessionReportWaitObservation => {
      const row = rows[0]
      return {
        condition: 'correlated-reply',
        correlationId: target.correlationId,
        ...(row
          ? {
              replyReportId: row.report_id,
              replyToReportId: row.reply_to_report_id,
              sourceSessionId: row.source_session_id,
              createdAt: row.created_at,
            }
          : {}),
      }
    }),
  )
}
