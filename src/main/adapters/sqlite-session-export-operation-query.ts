import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionQueryRequest } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import {
  type SessionExportOperationRow,
  sessionExportOperationRecord,
  sessionExportOperationSummary,
} from './sqlite-session-export-operation-row'
import {
  decodeSessionQueryCursor,
  encodeSessionQueryCursor,
  invalidSessionQueryCursor,
  sessionQueryResponse,
} from './sqlite-session-query-support'

type ListRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { operation: 'exports-list' }>
}

type ReadRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { operation: 'exports-read' }>
}

function listCursor(request: ListRequest) {
  const cursor = decodeSessionQueryCursor(request.query.cursor)
  if (cursor === 'invalid') return 'invalid' as const
  if (!cursor) return null
  return typeof cursor.updatedAt === 'number' && typeof cursor.exportOperationId === 'string'
    ? { updatedAt: cursor.updatedAt, exportOperationId: cursor.exportOperationId }
    : ('invalid' as const)
}

export function listSessionExportOperations(sql: SqlClient.SqlClient, request: ListRequest) {
  const cursor = listCursor(request)
  if (cursor === 'invalid') return Effect.succeed(invalidSessionQueryCursor(request))
  const statuses = request.query.statuses ?? [
    'queued',
    'running',
    'cancelling',
    'completed',
    'failed',
    'cancelled',
  ]
  return Effect.gen(function* () {
    const rows = yield* sql<SessionExportOperationRow>`
      SELECT * FROM session_export_operations
      WHERE session_id = ${request.query.sessionId}
        AND status IN ${sql.in(statuses)}
        AND (${cursor?.updatedAt ?? null} IS NULL
          OR updated_at < ${cursor?.updatedAt ?? null}
          OR (updated_at = ${cursor?.updatedAt ?? null}
            AND id < ${cursor?.exportOperationId ?? null}))
      ORDER BY updated_at DESC, id DESC
      LIMIT ${request.query.limit + 1}
    `
    const page = rows.slice(0, request.query.limit)
    const last = page.at(-1)
    return sessionQueryResponse(request, {
      operation: 'exports-list',
      sessionId: request.query.sessionId,
      exports: page.map(sessionExportOperationRecord).map(sessionExportOperationSummary),
      ...(rows.length > request.query.limit && last
        ? {
            nextCursor: encodeSessionQueryCursor({
              updatedAt: last.updated_at,
              exportOperationId: last.id,
            }),
          }
        : {}),
    })
  })
}

export function readSessionExportOperation(sql: SqlClient.SqlClient, request: ReadRequest) {
  return Effect.gen(function* () {
    const rows = yield* sql<SessionExportOperationRow>`
      SELECT * FROM session_export_operations
      WHERE id = ${request.query.exportOperationId}
        AND session_id = ${request.query.sessionId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) {
      return sessionQueryResponse(request, {
        operation: 'exports-read',
        error: { code: 'export_not_found', message: 'Session export operation not found.' },
      })
    }
    return sessionQueryResponse(request, {
      operation: 'exports-read',
      export: sessionExportOperationSummary(sessionExportOperationRecord(row)),
    })
  })
}
