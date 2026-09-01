import type * as SqlClient from '@effect/sql/SqlClient'
import {
  normalizeSessionReportReference,
  type SessionReportReferenceKind,
} from '@shared/session-report-reference'
import * as Effect from 'effect/Effect'

function upsertReference(
  sql: SqlClient.SqlClient,
  sessionId: string,
  kind: SessionReportReferenceKind,
  value: string,
) {
  const normalized = normalizeSessionReportReference(value)
  if (normalized.length === 0) {
    return sql`DELETE FROM session_report_references
      WHERE session_id = ${sessionId} AND kind = ${kind}`
  }
  return sql`
    INSERT INTO session_report_references (session_id, kind, normalized_reference)
    VALUES (${sessionId}, ${kind}, ${normalized})
    ON CONFLICT (session_id, kind) DO UPDATE SET
      normalized_reference = excluded.normalized_reference
  `
}

export function persistSessionReportReferences(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly title: string
    readonly agentDefinitionName?: string
  },
) {
  return Effect.gen(function* () {
    yield* upsertReference(sql, input.sessionId, 'session-id', input.sessionId)
    yield* upsertReference(sql, input.sessionId, 'title', input.title)
    yield* upsertReference(
      sql,
      input.sessionId,
      'agent-definition',
      input.agentDefinitionName ?? '',
    )
  })
}

export function persistSessionReportTitleReference(
  sql: SqlClient.SqlClient,
  sessionId: string,
  title: string,
) {
  return upsertReference(sql, sessionId, 'title', title)
}
