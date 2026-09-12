import type * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_QUERY_MAX_RESPONSE_BYTES } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { SESSION_QUERY_SQL_READ_BUDGET_BYTES } from './session-query-byte-pagination'
import {
  EXPORT_NODE_ESTIMATE_OVERHEAD_BYTES,
  type ExportPathNodeReadInput,
  type ExportPathNodeSizeRow,
  readCheckpointedExportNodeSizes,
} from './sqlite-session-export-checkpoint-reader'
import type { ExportNodeRow } from './sqlite-session-export-record'

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
    : ('checkpointed-branch' as const)
}

function selectExportSizePrefix(rows: readonly ExportPathNodeSizeRow[], limit: number) {
  const selected: ExportPathNodeSizeRow[] = []
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

export interface ExportNodeReadInput extends ExportPathNodeReadInput {
  readonly tree: boolean
  readonly indexedBranchId: string | null
}

function readIndexedExportNodeSizes(sql: SqlClient.SqlClient, input: ExportNodeReadInput) {
  if (input.tree) {
    return sql<ExportPathNodeSizeRow>`
      SELECT id AS node_id, created_order,
        length(CAST(content_json AS BLOB)) + length(CAST(metadata_json AS BLOB)) +
          ${EXPORT_NODE_ESTIMATE_OVERHEAD_BYTES} AS estimated_bytes,
        0 AS path_read_steps
      FROM session_nodes
      WHERE session_id = ${input.sessionId}
        AND created_order > ${input.afterCreatedOrder}
        AND created_order <= ${input.throughCreatedOrder}
      ORDER BY created_order ASC
      LIMIT ${input.limit + 1}
    `
  }
  return sql<ExportPathNodeSizeRow>`
    SELECT id AS node_id, created_order,
      length(CAST(content_json AS BLOB)) + length(CAST(metadata_json AS BLOB)) +
        ${EXPORT_NODE_ESTIMATE_OVERHEAD_BYTES} AS estimated_bytes,
      0 AS path_read_steps
    FROM session_nodes
    WHERE session_id = ${input.sessionId}
      AND branch_hint_id = ${input.indexedBranchId}
      AND created_order > ${input.afterCreatedOrder}
      AND created_order <= ${input.throughCreatedOrder}
    ORDER BY created_order ASC
    LIMIT ${input.limit + 1}
  `
}

function readExportNodeSizes(sql: SqlClient.SqlClient, input: ExportNodeReadInput) {
  return input.tree || input.indexedBranchId
    ? readIndexedExportNodeSizes(sql, input)
    : readCheckpointedExportNodeSizes(sql, input)
}

function readExportNodeRows(
  sql: SqlClient.SqlClient,
  sessionId: string,
  nodeIds: readonly string[],
) {
  return sql<ExportNodeRow>`
    SELECT id, parent_id, branch_hint_id, role, kind, timestamp_ms, created_order,
      content_json, metadata_json
    FROM session_nodes
    WHERE session_id = ${sessionId}
      AND id IN ${sql.in(nodeIds)}
    ORDER BY created_order ASC
  `
}

export function readExportNodes(sql: SqlClient.SqlClient, input: ExportNodeReadInput) {
  return Effect.gen(function* () {
    if (!input.tree && !input.headNodeId) {
      return {
        rows: EMPTY_EXPORT_NODE_ROWS,
        hasMore: false,
        oversized: false,
        pathReadSteps: 0,
      }
    }
    const sizes = yield* readExportNodeSizes(sql, input)
    const pathReadSteps = sizes[0]?.path_read_steps ?? 0
    const selected = selectExportSizePrefix(sizes, input.limit)
    if ((selected[0]?.estimated_bytes ?? 0) > SESSION_QUERY_MAX_RESPONSE_BYTES) {
      return { rows: EMPTY_EXPORT_NODE_ROWS, hasMore: false, oversized: true, pathReadSteps }
    }
    if (selected.length === 0) {
      return {
        rows: EMPTY_EXPORT_NODE_ROWS,
        hasMore: false,
        oversized: false,
        pathReadSteps,
      }
    }
    const rows = yield* readExportNodeRows(
      sql,
      input.sessionId,
      selected.map((row) => row.node_id),
    )
    return {
      rows,
      hasMore: sizes.length > selected.length,
      oversized: false,
      pathReadSteps,
    }
  })
}
