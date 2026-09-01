import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionExportOperationStatus } from '@shared/types/session-export-operation'
import {
  SESSION_QUERY_MAX_RESPONSE_BYTES,
  type SessionQueryRequest,
} from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import {
  byteBoundedPage,
  SESSION_QUERY_SQL_READ_BUDGET_BYTES,
} from './session-query-byte-pagination'
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

interface ExportOperationSizeRow {
  readonly id: string
  readonly updated_at: number
  readonly estimated_bytes: number
}

function selectSizePrefix(rows: readonly ExportOperationSizeRow[], limit: number) {
  const selected: ExportOperationSizeRow[] = []
  let bytes = 0
  for (const row of rows.slice(0, limit)) {
    if (selected.length > 0 && bytes + row.estimated_bytes > SESSION_QUERY_SQL_READ_BUDGET_BYTES) {
      break
    }
    selected.push(row)
    bytes += row.estimated_bytes
  }
  return selected
}

function listCursor(request: ListRequest) {
  const cursor = decodeSessionQueryCursor(request.query.cursor)
  if (cursor === 'invalid') return 'invalid' as const
  if (!cursor) return null
  return typeof cursor.updatedAt === 'number' && typeof cursor.exportOperationId === 'string'
    ? { updatedAt: cursor.updatedAt, exportOperationId: cursor.exportOperationId }
    : ('invalid' as const)
}

type ValidListCursor = Exclude<ReturnType<typeof listCursor>, 'invalid'>

function listOperationSizesWithBodies(
  sql: SqlClient.SqlClient,
  request: ListRequest,
  cursor: ValidListCursor,
  statuses: readonly SessionExportOperationStatus[],
) {
  return sql<ExportOperationSizeRow>`
    SELECT id, updated_at,
      length(CAST(resources_json AS BLOB)) +
        COALESCE(length(CAST(manifest_json AS BLOB)), 0) +
        COALESCE(length(CAST(error_json AS BLOB)), 0) + 8192 AS estimated_bytes
    FROM session_export_operations
    WHERE session_id = ${request.query.sessionId}
      AND status IN ${sql.in(statuses)}
      AND (${cursor?.updatedAt ?? null} IS NULL
        OR updated_at < ${cursor?.updatedAt ?? null}
        OR (updated_at = ${cursor?.updatedAt ?? null}
          AND id < ${cursor?.exportOperationId ?? null}))
    ORDER BY updated_at DESC, id DESC
    LIMIT ${request.query.limit + 1}
  `
}

function listOperationSummarySizes(
  sql: SqlClient.SqlClient,
  request: ListRequest,
  cursor: ValidListCursor,
  statuses: readonly SessionExportOperationStatus[],
) {
  return sql<ExportOperationSizeRow>`
    SELECT id, updated_at,
      length(CAST(resources_json AS BLOB)) +
        COALESCE(length(CAST(manifest_json AS BLOB)), 0) +
        COALESCE(length(CAST(error_json AS BLOB)), 0) + 8192 AS estimated_bytes
    FROM session_export_operation_summaries
    WHERE session_id = ${request.query.sessionId}
      AND status IN ${sql.in(statuses)}
      AND (${cursor?.updatedAt ?? null} IS NULL
        OR updated_at < ${cursor?.updatedAt ?? null}
        OR (updated_at = ${cursor?.updatedAt ?? null}
          AND id < ${cursor?.exportOperationId ?? null}))
    ORDER BY updated_at DESC, id DESC
    LIMIT ${request.query.limit + 1}
  `
}

function listOperationSizes(
  sql: SqlClient.SqlClient,
  request: ListRequest,
  cursor: ValidListCursor,
  statuses: readonly SessionExportOperationStatus[],
) {
  return request.query.includeQueueBodies
    ? listOperationSizesWithBodies(sql, request, cursor, statuses)
    : listOperationSummarySizes(sql, request, cursor, statuses)
}

function listOperationRows(
  sql: SqlClient.SqlClient,
  request: ListRequest,
  selectedIds: readonly string[],
) {
  if (selectedIds.length === 0) return Effect.succeed<readonly SessionExportOperationRow[]>([])
  if (request.query.includeQueueBodies) {
    return sql<SessionExportOperationRow>`
      SELECT * FROM session_export_operations
      WHERE id IN ${sql.in(selectedIds)}
      ORDER BY updated_at DESC, id DESC
    `
  }
  return sql<SessionExportOperationRow>`
    SELECT * FROM session_export_operation_summaries
    WHERE id IN ${sql.in(selectedIds)}
    ORDER BY updated_at DESC, id DESC
  `
}

function readOperationRows(sql: SqlClient.SqlClient, request: ReadRequest) {
  if (request.query.includeQueueBodies) {
    return sql<SessionExportOperationRow>`
      SELECT * FROM session_export_operations
      WHERE id = ${request.query.exportOperationId}
        AND session_id = ${request.query.sessionId}
      LIMIT 1
    `
  }
  return sql<SessionExportOperationRow>`
    SELECT * FROM session_export_operation_summaries
    WHERE id = ${request.query.exportOperationId}
      AND session_id = ${request.query.sessionId}
    LIMIT 1
  `
}

function exportOperationPage(
  request: ListRequest,
  rows: readonly SessionExportOperationRow[],
  hasAdditionalCandidates: boolean,
) {
  const candidates = rows.map(sessionExportOperationRecord).map((record) =>
    sessionExportOperationSummary(record, {
      includeQueueBodies: request.query.includeQueueBodies === true,
    }),
  )
  const baseOutcome = {
    operation: 'exports-list',
    sessionId: request.query.sessionId,
  } as const
  const page = byteBoundedPage({
    candidates,
    hasAdditionalCandidates,
    emptyResponse: sessionQueryResponse(request, { ...baseOutcome, exports: [] }),
  })
  if (!page.accepted) {
    return sessionQueryResponse(request, {
      operation: 'exports-list',
      error: {
        code: 'record_too_large',
        message: 'An export operation exceeds the maximum Session query response size.',
      },
    })
  }
  const last = page.records.at(-1)
  return sessionQueryResponse(request, {
    ...baseOutcome,
    exports: page.records,
    ...(page.hasMore && last
      ? {
          nextCursor: encodeSessionQueryCursor({
            updatedAt: last.updatedAt,
            exportOperationId: last.exportOperationId,
          }),
        }
      : {}),
  })
}

export function listSessionExportOperations(sql: SqlClient.SqlClient, request: ListRequest) {
  const cursor = listCursor(request)
  if (cursor === 'invalid') return Effect.succeed(invalidSessionQueryCursor(request))
  const defaultStatuses: readonly SessionExportOperationStatus[] = [
    'queued',
    'running',
    'installing',
    'cancelling',
    'completed',
    'failed',
    'cancelled',
  ]
  const statuses: readonly SessionExportOperationStatus[] = [
    ...new Set(request.query.statuses ?? defaultStatuses),
  ]
  return Effect.gen(function* () {
    const sizes = yield* listOperationSizes(sql, request, cursor, statuses)
    const selected = selectSizePrefix(sizes, request.query.limit)
    if ((selected[0]?.estimated_bytes ?? 0) > SESSION_QUERY_MAX_RESPONSE_BYTES) {
      return sessionQueryResponse(request, {
        operation: 'exports-list',
        error: {
          code: 'record_too_large',
          message: 'An export operation exceeds the maximum Session query response size.',
        },
      })
    }
    const selectedIds = selected.map((row) => row.id)
    const rows = yield* listOperationRows(sql, request, selectedIds)
    return exportOperationPage(request, rows, sizes.length > selected.length)
  })
}

export function readSessionExportOperation(sql: SqlClient.SqlClient, request: ReadRequest) {
  return Effect.gen(function* () {
    const rows = yield* readOperationRows(sql, request)
    const row = rows[0]
    if (!row) {
      return sessionQueryResponse(request, {
        operation: 'exports-read',
        error: { code: 'export_not_found', message: 'Session export operation not found.' },
      })
    }
    return sessionQueryResponse(request, {
      operation: 'exports-read',
      export: sessionExportOperationSummary(sessionExportOperationRecord(row), {
        includeQueueBodies: request.query.includeQueueBodies === true,
      }),
    })
  })
}
