import type * as SqlClient from '@effect/sql/SqlClient'
import {
  SESSION_QUERY_MAX_RESPONSE_BYTES,
  type SessionQueryRequest,
} from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import {
  byteBoundedPage,
  SESSION_QUERY_SQL_READ_BUDGET_BYTES,
} from './session-query-byte-pagination'
import { parseSessionJson, sessionQueryResponse } from './sqlite-session-query-support'

type ItemsRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { readonly operation: 'items' }>
}

interface ItemRow {
  readonly id: string
  readonly parent_id: string | null
  readonly role: string | null
  readonly kind: string
  readonly timestamp_ms: number
  readonly created_order: number
  readonly content_json: string
  readonly metadata_json: string
}

interface ItemSizeRow {
  readonly created_order: number
  readonly estimated_bytes: number
}

function selectItemSizePrefix(rows: readonly ItemSizeRow[], limit: number) {
  const selected: ItemSizeRow[] = []
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

function itemSizes(sql: SqlClient.SqlClient, request: ItemsRequest, highWaterMark: number) {
  const { query } = request
  const base = sql<ItemSizeRow>`
    SELECT created_order,
      length(CAST(content_json AS BLOB)) + length(CAST(metadata_json AS BLOB)) + 4096
        AS estimated_bytes
    FROM session_nodes
    WHERE session_id = ${query.sessionId}
      AND created_order > ${query.afterCreatedOrder ?? -1}
      AND created_order <= ${highWaterMark}
    ORDER BY created_order ASC
    LIMIT ${query.limit + 1}
  `
  if (!query.runId) return base
  return sql<ItemSizeRow>`
    SELECT created_order,
      length(CAST(content_json AS BLOB)) + length(CAST(metadata_json AS BLOB)) + 4096
        AS estimated_bytes
    FROM session_nodes
    WHERE session_id = ${query.sessionId}
      AND json_extract(metadata_json, '$.openWaggle.runId') = ${query.runId}
      AND created_order > ${query.afterCreatedOrder ?? -1}
      AND created_order <= ${highWaterMark}
    ORDER BY created_order ASC
    LIMIT ${query.limit + 1}
  `
}

function itemRows(
  sql: SqlClient.SqlClient,
  request: ItemsRequest,
  selectedThrough: number | undefined,
) {
  if (selectedThrough === undefined) return Effect.succeed<readonly ItemRow[]>([])
  const { query } = request
  const base = sql<ItemRow>`
    SELECT id, parent_id, role, kind, timestamp_ms, created_order,
      content_json, metadata_json
    FROM session_nodes
    WHERE session_id = ${query.sessionId}
      AND created_order > ${query.afterCreatedOrder ?? -1}
      AND created_order <= ${selectedThrough}
    ORDER BY created_order ASC
  `
  if (!query.runId) return base
  return sql<ItemRow>`
    SELECT id, parent_id, role, kind, timestamp_ms, created_order,
      content_json, metadata_json
    FROM session_nodes
    WHERE session_id = ${query.sessionId}
      AND json_extract(metadata_json, '$.openWaggle.runId') = ${query.runId}
      AND created_order > ${query.afterCreatedOrder ?? -1}
      AND created_order <= ${selectedThrough}
    ORDER BY created_order ASC
  `
}

function itemRecord(row: ItemRow) {
  const metadata = parseSessionJson(row.metadata_json)
  const openWaggle =
    typeof metadata === 'object' && metadata !== null && 'openWaggle' in metadata
      ? metadata.openWaggle
      : undefined
  const runId =
    typeof openWaggle === 'object' && openWaggle !== null && 'runId' in openWaggle
      ? openWaggle.runId
      : undefined
  return {
    nodeId: row.id,
    parentNodeId: row.parent_id,
    role: row.role,
    kind: row.kind,
    timestampMs: row.timestamp_ms,
    createdOrder: row.created_order,
    ...(typeof runId === 'string' ? { runId } : {}),
    content: parseSessionJson(row.content_json),
    metadata,
  }
}

export function readItems(sql: SqlClient.SqlClient, request: SessionQueryRequest) {
  if (request.query.operation !== 'items') throw new Error('Expected items query.')
  const itemsRequest = { ...request, query: request.query }
  const { query } = itemsRequest
  return Effect.gen(function* () {
    const sessionRows = yield* sql<{
      readonly session_exists: number
      readonly high_water_mark: number
    }>`
      SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ${query.sessionId}) AS session_exists,
        COALESCE(MAX(created_order), 0) AS high_water_mark
      FROM session_nodes
      WHERE session_id = ${query.sessionId}
    `
    const snapshot = sessionRows[0]
    if (snapshot?.session_exists !== 1) {
      return sessionQueryResponse(request, {
        operation: 'items',
        error: { code: 'session_not_found', message: 'Session not found.' },
      })
    }
    const highWaterMark = query.throughCreatedOrder ?? snapshot.high_water_mark
    const sizeRows = yield* itemSizes(sql, itemsRequest, highWaterMark)
    const selectedSizes = selectItemSizePrefix(sizeRows, query.limit)
    if ((selectedSizes[0]?.estimated_bytes ?? 0) > SESSION_QUERY_MAX_RESPONSE_BYTES) {
      return sessionQueryResponse(request, {
        operation: 'items',
        error: {
          code: 'record_too_large',
          message: 'A transcript item exceeds the maximum Session query response size.',
        },
      })
    }
    const rows = yield* itemRows(sql, itemsRequest, selectedSizes.at(-1)?.created_order)
    const candidates = rows.slice(0, query.limit).map(itemRecord)
    const baseOutcome = { operation: 'items', sessionId: query.sessionId, highWaterMark } as const
    const page = byteBoundedPage({
      candidates,
      hasAdditionalCandidates: sizeRows.length > selectedSizes.length,
      emptyResponse: sessionQueryResponse(request, { ...baseOutcome, items: [] }),
    })
    if (!page.accepted) {
      return sessionQueryResponse(request, {
        operation: 'items',
        error: {
          code: 'record_too_large',
          message: 'A transcript item exceeds the maximum Session query response size.',
        },
      })
    }
    const last = page.records.at(-1)
    return sessionQueryResponse(request, {
      ...baseOutcome,
      items: page.records,
      ...(page.hasMore && last ? { nextCreatedOrder: last.createdOrder } : {}),
    })
  })
}
