import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { uncheckedFields } from '@shared/utils/object-shape'
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
          const { followUpId } = uncheckedFields<{ readonly followUpId: string }>(request)
          if (typeof followUpId === 'string') ids.add(followUpId)
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
          return (
            uncheckedFields<{ readonly expectedRunId: string }>(request).expectedRunId === runId
          )
        } catch {
          return false
        }
      }),
    ),
  )
}
