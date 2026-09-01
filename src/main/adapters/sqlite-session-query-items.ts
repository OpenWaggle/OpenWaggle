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
import { resolveItemSnapshot } from './sqlite-session-query-item-snapshot'
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
  readonly branch_hint_id: string | null
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

function itemSizes(
  sql: SqlClient.SqlClient,
  request: ItemsRequest,
  highWaterMark: number,
  headNodeId: string | null,
  tree: boolean,
  indexedBranchId: string | null,
) {
  const { query } = request
  if (!tree && !headNodeId) return Effect.succeed<readonly ItemSizeRow[]>([])
  if (tree) {
    return sql<ItemSizeRow>`
      SELECT created_order,
        length(CAST(content_json AS BLOB)) + length(CAST(metadata_json AS BLOB)) + 4096
        AS estimated_bytes
      FROM session_nodes
      WHERE session_id = ${query.sessionId}
        AND created_order > ${query.afterCreatedOrder ?? -1}
        AND created_order <= ${highWaterMark}
        AND (${query.runId ?? null} IS NULL
          OR json_extract(metadata_json, '$.openWaggle.runId') = ${query.runId ?? null})
      ORDER BY created_order ASC
      LIMIT ${query.limit + 1}
    `
  }
  if (indexedBranchId) {
    return sql<ItemSizeRow>`
      SELECT created_order,
        length(CAST(content_json AS BLOB)) + length(CAST(metadata_json AS BLOB)) + 4096
        AS estimated_bytes
      FROM session_nodes
      WHERE session_id = ${query.sessionId}
        AND branch_hint_id = ${indexedBranchId}
        AND created_order > ${query.afterCreatedOrder ?? -1}
        AND created_order <= ${highWaterMark}
        AND (${query.runId ?? null} IS NULL
          OR json_extract(metadata_json, '$.openWaggle.runId') = ${query.runId ?? null})
      ORDER BY created_order ASC
      LIMIT ${query.limit + 1}
    `
  }
  return sql<ItemSizeRow>`
    WITH RECURSIVE selected_path(id) AS (
      SELECT id FROM session_nodes
      WHERE id = ${headNodeId} AND session_id = ${query.sessionId}
      UNION ALL
      SELECT nodes.parent_id
      FROM session_nodes AS nodes
      JOIN selected_path ON selected_path.id = nodes.id
      WHERE nodes.parent_id IS NOT NULL
    )
    SELECT nodes.created_order,
      length(CAST(nodes.content_json AS BLOB)) +
        length(CAST(nodes.metadata_json AS BLOB)) + 4096 AS estimated_bytes
    FROM session_nodes AS nodes
    JOIN selected_path ON selected_path.id = nodes.id
    WHERE nodes.session_id = ${query.sessionId}
      AND nodes.created_order > ${query.afterCreatedOrder ?? -1}
      AND nodes.created_order <= ${highWaterMark}
      AND (${query.runId ?? null} IS NULL
        OR json_extract(nodes.metadata_json, '$.openWaggle.runId') = ${query.runId ?? null})
    ORDER BY nodes.created_order ASC
    LIMIT ${query.limit + 1}
  `
}

function itemRows(
  sql: SqlClient.SqlClient,
  request: ItemsRequest,
  selectedThrough: number | undefined,
  headNodeId: string | null,
  tree: boolean,
  indexedBranchId: string | null,
) {
  if (selectedThrough === undefined) return Effect.succeed<readonly ItemRow[]>([])
  const { query } = request
  if (tree) {
    return sql<ItemRow>`
      SELECT id, parent_id, role, kind, timestamp_ms, created_order, branch_hint_id,
        content_json, metadata_json
      FROM session_nodes
      WHERE session_id = ${query.sessionId}
        AND created_order > ${query.afterCreatedOrder ?? -1}
        AND created_order <= ${selectedThrough}
        AND (${query.runId ?? null} IS NULL
          OR json_extract(metadata_json, '$.openWaggle.runId') = ${query.runId ?? null})
      ORDER BY created_order ASC
    `
  }
  if (indexedBranchId) {
    return sql<ItemRow>`
      SELECT id, parent_id, role, kind, timestamp_ms, created_order, branch_hint_id,
        content_json, metadata_json
      FROM session_nodes
      WHERE session_id = ${query.sessionId}
        AND branch_hint_id = ${indexedBranchId}
        AND created_order > ${query.afterCreatedOrder ?? -1}
        AND created_order <= ${selectedThrough}
        AND (${query.runId ?? null} IS NULL
          OR json_extract(metadata_json, '$.openWaggle.runId') = ${query.runId ?? null})
      ORDER BY created_order ASC
    `
  }
  return sql<ItemRow>`
    WITH RECURSIVE selected_path(id) AS (
      SELECT id FROM session_nodes
      WHERE id = ${headNodeId} AND session_id = ${query.sessionId}
      UNION ALL
      SELECT nodes.parent_id
      FROM session_nodes AS nodes
      JOIN selected_path ON selected_path.id = nodes.id
      WHERE nodes.parent_id IS NOT NULL
    )
    SELECT nodes.id, nodes.parent_id, nodes.role, nodes.kind, nodes.timestamp_ms,
      nodes.created_order, nodes.branch_hint_id, nodes.content_json, nodes.metadata_json
    FROM session_nodes AS nodes
    JOIN selected_path ON selected_path.id = nodes.id
    WHERE nodes.session_id = ${query.sessionId}
      AND nodes.created_order > ${query.afterCreatedOrder ?? -1}
      AND nodes.created_order <= ${selectedThrough}
      AND (${query.runId ?? null} IS NULL
        OR json_extract(nodes.metadata_json, '$.openWaggle.runId') = ${query.runId ?? null})
    ORDER BY nodes.created_order ASC
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
    branchHintId: row.branch_hint_id,
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
    const snapshot = yield* resolveItemSnapshot(sql, query)
    if (snapshot.status === 'session-not-found') {
      return sessionQueryResponse(request, {
        operation: 'items',
        error: { code: 'session_not_found', message: 'Session not found.' },
      })
    }
    if (snapshot.status === 'branch-not-found') {
      return sessionQueryResponse(request, {
        operation: 'items',
        error: { code: 'branch_not_found', message: 'Session transcript branch not found.' },
      })
    }
    const highWaterMark = snapshot.highWaterMark
    // Snapshot persistence assigns the active branch hint to every node on its complete path.
    // A pinned branch that is no longer active must retain the recursive fallback because shared
    // ancestors are re-attributed when the active branch changes.
    const indexedBranchId =
      snapshot.selectedBranchId !== null && snapshot.selectedBranchId === snapshot.activeBranchId
        ? snapshot.selectedBranchId
        : null
    const sizeRows = yield* itemSizes(
      sql,
      itemsRequest,
      highWaterMark,
      snapshot.headNodeId,
      snapshot.branchScope === 'tree',
      indexedBranchId,
    )
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
    const rows = yield* itemRows(
      sql,
      itemsRequest,
      selectedSizes.at(-1)?.created_order,
      snapshot.headNodeId,
      snapshot.branchScope === 'tree',
      indexedBranchId,
    )
    const candidates = rows.slice(0, query.limit).map(itemRecord)
    const baseOutcome = {
      operation: 'items',
      sessionId: query.sessionId,
      highWaterMark,
      branchScope: snapshot.branchScope,
      selectedBranchId: snapshot.selectedBranchId,
      snapshotHeadNodeId: snapshot.headNodeId,
    } as const
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
