import type * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_QUERY_MAX_RESPONSE_BYTES } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { SESSION_QUERY_SQL_READ_BUDGET_BYTES } from './session-query-byte-pagination'
import type { ExportNodeRow } from './sqlite-session-export-record'

interface ExportNodeSizeRow {
  readonly created_order: number
  readonly estimated_bytes: number
}

const EMPTY_EXPORT_NODE_ROWS: readonly ExportNodeRow[] = []

export function exportNodeReadStrategy(input: {
  readonly tree: boolean
  readonly selectedBranchId: string | null
  readonly activeBranchId: string | null
  readonly selectedHeadNodeId: string | null
  readonly branchHeadNodeId: string | null
}) {
  if (input.tree) return 'tree' as const
  return input.selectedBranchId !== null &&
    input.selectedBranchId === input.activeBranchId &&
    input.selectedHeadNodeId !== null &&
    input.selectedHeadNodeId === input.branchHeadNodeId
    ? ('indexed-active-branch' as const)
    : ('recursive-branch' as const)
}

function selectExportSizePrefix(rows: readonly ExportNodeSizeRow[], limit: number) {
  const selected: ExportNodeSizeRow[] = []
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

export function readExportNodes(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly headNodeId: string | null
    readonly tree: boolean
    readonly indexedBranchId: string | null
    readonly afterCreatedOrder: number
    readonly throughCreatedOrder: number
    readonly limit: number
  },
) {
  return Effect.gen(function* () {
    if (!input.tree && !input.headNodeId) {
      return { rows: EMPTY_EXPORT_NODE_ROWS, hasMore: false, oversized: false }
    }
    const sizes = input.tree
      ? yield* sql<ExportNodeSizeRow>`
          SELECT created_order,
            length(CAST(content_json AS BLOB)) + length(CAST(metadata_json AS BLOB)) + 4096
              AS estimated_bytes
          FROM session_nodes
          WHERE session_id = ${input.sessionId}
            AND created_order > ${input.afterCreatedOrder}
            AND created_order <= ${input.throughCreatedOrder}
          ORDER BY created_order ASC
          LIMIT ${input.limit + 1}
        `
      : input.indexedBranchId
        ? yield* sql<ExportNodeSizeRow>`
            SELECT created_order,
              length(CAST(content_json AS BLOB)) + length(CAST(metadata_json AS BLOB)) + 4096
                AS estimated_bytes
            FROM session_nodes
            WHERE session_id = ${input.sessionId}
              AND branch_hint_id = ${input.indexedBranchId}
              AND created_order > ${input.afterCreatedOrder}
              AND created_order <= ${input.throughCreatedOrder}
            ORDER BY created_order ASC
            LIMIT ${input.limit + 1}
          `
        : yield* sql<ExportNodeSizeRow>`
          WITH RECURSIVE selected_path(id) AS (
            SELECT id FROM session_nodes
            WHERE id = ${input.headNodeId} AND session_id = ${input.sessionId}
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
          WHERE nodes.session_id = ${input.sessionId}
            AND nodes.created_order > ${input.afterCreatedOrder}
            AND nodes.created_order <= ${input.throughCreatedOrder}
          ORDER BY nodes.created_order ASC
          LIMIT ${input.limit + 1}
        `
    const selected = selectExportSizePrefix(sizes, input.limit)
    if ((selected[0]?.estimated_bytes ?? 0) > SESSION_QUERY_MAX_RESPONSE_BYTES) {
      return { rows: EMPTY_EXPORT_NODE_ROWS, hasMore: false, oversized: true }
    }
    const selectedThrough = selected.at(-1)?.created_order
    if (selectedThrough === undefined) {
      return { rows: EMPTY_EXPORT_NODE_ROWS, hasMore: false, oversized: false }
    }
    const rows = input.tree
      ? yield* sql<ExportNodeRow>`
          SELECT id, parent_id, branch_hint_id, role, kind, timestamp_ms, created_order,
            content_json, metadata_json
          FROM session_nodes
          WHERE session_id = ${input.sessionId}
            AND created_order > ${input.afterCreatedOrder}
            AND created_order <= ${selectedThrough}
          ORDER BY created_order ASC
        `
      : input.indexedBranchId
        ? yield* sql<ExportNodeRow>`
            SELECT id, parent_id, branch_hint_id, role, kind, timestamp_ms, created_order,
              content_json, metadata_json
            FROM session_nodes
            WHERE session_id = ${input.sessionId}
              AND branch_hint_id = ${input.indexedBranchId}
              AND created_order > ${input.afterCreatedOrder}
              AND created_order <= ${selectedThrough}
            ORDER BY created_order ASC
          `
        : yield* sql<ExportNodeRow>`
          WITH RECURSIVE selected_path(id) AS (
            SELECT id FROM session_nodes
            WHERE id = ${input.headNodeId} AND session_id = ${input.sessionId}
            UNION ALL
            SELECT nodes.parent_id
            FROM session_nodes AS nodes
            JOIN selected_path ON selected_path.id = nodes.id
            WHERE nodes.parent_id IS NOT NULL
          )
          SELECT nodes.id, nodes.parent_id, nodes.branch_hint_id, nodes.role, nodes.kind,
            nodes.timestamp_ms, nodes.created_order, nodes.content_json, nodes.metadata_json
          FROM session_nodes AS nodes
          JOIN selected_path ON selected_path.id = nodes.id
          WHERE nodes.session_id = ${input.sessionId}
            AND nodes.created_order > ${input.afterCreatedOrder}
            AND nodes.created_order <= ${selectedThrough}
          ORDER BY nodes.created_order ASC
        `
    return { rows, hasMore: sizes.length > selected.length, oversized: false }
  })
}
