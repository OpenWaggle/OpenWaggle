import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'

export function reservedFollowUpIds(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<{ readonly request_json: string }>`
    SELECT request_json
    FROM session_operations
    WHERE operation = ${'promote'}
      AND target_scope = ${sessionId}
      AND status = ${'pending'}
  `.pipe(
    Effect.map((rows) => {
      const ids = new Set<string>()
      for (const row of rows) {
        try {
          const request = parseJsonUnknown(row.request_json)
          if (isRecord(request) && typeof request.followUpId === 'string') {
            ids.add(request.followUpId)
          }
        } catch {
          // Invalid durable requests are handled by host recovery; do not reserve an unknown item.
        }
      }
      return ids
    }),
  )
}

export function hasPendingReplacementForRun(
  sql: SqlClient.SqlClient,
  sessionId: string,
  runId: string,
) {
  return sql<{ readonly request_json: string }>`
    SELECT request_json
    FROM session_operations
    WHERE operation = ${'replace'}
      AND target_scope = ${sessionId}
      AND status = ${'pending'}
  `.pipe(
    Effect.map((rows) =>
      rows.some((row) => {
        try {
          const request = parseJsonUnknown(row.request_json)
          return isRecord(request) && request.expectedRunId === runId
        } catch {
          return false
        }
      }),
    ),
  )
}
