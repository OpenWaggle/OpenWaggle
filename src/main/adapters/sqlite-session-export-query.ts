import type * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_EXPORT_SCHEMA_VERSION } from '@shared/types/session-export'
import {
  SESSION_QUERY_MAX_RESPONSE_BYTES,
  type SessionQueryRequest,
} from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import {
  byteBoundedPage,
  SESSION_QUERY_SQL_READ_BUDGET_BYTES,
} from './session-query-byte-pagination'
import { type ExportNodeRow, exportNodeRecord } from './sqlite-session-export-record'
import { resolveExportSnapshotHead } from './sqlite-session-export-snapshot'
import { parseSessionJson, sessionQueryResponse } from './sqlite-session-query-support'

type ExportRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { operation: 'export' }>
}

interface ExportNodeSizeRow {
  readonly created_order: number
  readonly estimated_bytes: number
}

interface ExportSnapshotRow {
  readonly title: string
  readonly last_active_branch_id: string | null
  readonly state_revision: number
  readonly queue_state: 'running' | 'paused'
  readonly queue_revision: number
  readonly active_run_id: string | null
  readonly node_high_water_mark: number
}

interface ExportQueueRow {
  readonly id: string
  readonly position: number
  readonly delivery_state: 'pending' | 'needs_attention'
  readonly attention_reason:
    | 'authorization_ceiling_changed'
    | 'profile_revoked'
    | 'authority_changed'
    | null
  readonly intent_json: string
  readonly created_at: number
}

const EMPTY_EXPORT_NODE_ROWS: readonly ExportNodeRow[] = []

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

function readExportNodes(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly headNodeId: string | null
    readonly tree: boolean
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

function exportBaseOutcome(input: {
  readonly request: ExportRequest
  readonly snapshot: ExportSnapshotRow
  readonly selectedBranchId: string | null
  readonly branchScope: 'active-branch' | 'tree'
  readonly highWaterMark: number
  readonly stateRevision: number
  readonly capturedAt: number
  readonly selectedHeadNodeId: string | null
  readonly queueRows: readonly ExportQueueRow[]
}) {
  const { query } = input.request
  return {
    operation: 'export',
    manifest: {
      schemaVersion: SESSION_EXPORT_SCHEMA_VERSION,
      sessionId: query.sessionId,
      title: input.snapshot.title,
      branchScope: input.branchScope,
      activeBranchId: input.snapshot.last_active_branch_id,
      selectedBranchId: input.branchScope === 'tree' ? null : input.selectedBranchId,
      snapshot: {
        nodeHighWaterMark: input.highWaterMark,
        stateRevision: input.stateRevision,
        queueRevision: input.snapshot.queue_revision,
        capturedAt: input.capturedAt,
        ...(input.selectedHeadNodeId ? { selectedHeadNodeId: input.selectedHeadNodeId } : {}),
      },
      activeRunId: input.snapshot.active_run_id,
      activeTurnIncomplete: input.snapshot.active_run_id !== null,
      queue: {
        state: input.snapshot.queue_state,
        pendingCount: input.queueRows.length,
        bodyScope: query.includeQueueBodies ? 'included' : 'omitted-by-choice',
        omittedBodyCount: query.includeQueueBodies ? 0 : input.queueRows.length,
        items: input.queueRows.map((row) => ({
          followUpId: row.id,
          position: row.position,
          createdAt: row.created_at,
          deliveryState: row.delivery_state,
          ...(row.attention_reason ? { attentionReason: row.attention_reason } : {}),
          ...(query.includeQueueBodies ? { intent: parseSessionJson(row.intent_json) } : {}),
        })),
      },
    },
  } as const
}

export function readSessionExport(sql: SqlClient.SqlClient, request: ExportRequest) {
  const query = request.query
  return Effect.gen(function* () {
    const snapshots = yield* sql<ExportSnapshotRow>`
      SELECT sessions.title, sessions.last_active_branch_id,
        session_control_states.state_revision, session_control_states.queue_state,
        session_control_states.queue_revision, session_control_states.active_run_id,
        COALESCE(MAX(session_nodes.created_order), 0) AS node_high_water_mark
      FROM sessions
      JOIN session_control_states ON session_control_states.session_id = sessions.id
      LEFT JOIN session_nodes ON session_nodes.session_id = sessions.id
      WHERE sessions.id = ${query.sessionId}
      GROUP BY sessions.id
    `
    const snapshot = snapshots[0]
    if (!snapshot) {
      return sessionQueryResponse(request, {
        operation: 'export',
        error: { code: 'session_not_found', message: 'Session not found.' },
      })
    }
    const branchScope = query.branchScope ?? 'active-branch'
    const selectedBranchId = query.branchId ?? snapshot.last_active_branch_id
    const head = yield* resolveExportSnapshotHead(sql, {
      sessionId: query.sessionId,
      branchScope,
      selectedBranchId,
      ...(query.snapshotHeadNodeId ? { suppliedHeadNodeId: query.snapshotHeadNodeId } : {}),
    })
    if (head.status === 'not-found') {
      return sessionQueryResponse(request, {
        operation: 'export',
        error: { code: 'branch_not_found', message: head.message },
      })
    }
    const selectedHeadNodeId = head.headNodeId
    const queueRows = yield* sql<ExportQueueRow>`
      SELECT id, position, delivery_state, attention_reason, intent_json, created_at
      FROM session_follow_ups
      WHERE session_id = ${query.sessionId}
      ORDER BY position, id
    `
    const highWaterMark = query.throughCreatedOrder ?? snapshot.node_high_water_mark
    const stateRevision = query.snapshotStateRevision ?? snapshot.state_revision
    const capturedAt = query.capturedAt ?? Date.now()
    const nodePage = yield* readExportNodes(sql, {
      sessionId: query.sessionId,
      headNodeId: selectedHeadNodeId,
      tree: branchScope === 'tree',
      afterCreatedOrder: query.afterCreatedOrder ?? -1,
      throughCreatedOrder: highWaterMark,
      limit: query.limit,
    })
    if (nodePage.oversized) {
      return sessionQueryResponse(request, {
        operation: 'export',
        error: {
          code: 'record_too_large',
          message: 'An export record exceeds the maximum Session query response size.',
        },
      })
    }
    const baseOutcome = exportBaseOutcome({
      request,
      snapshot,
      selectedBranchId,
      branchScope,
      highWaterMark,
      stateRevision,
      capturedAt,
      selectedHeadNodeId,
      queueRows,
    })
    const candidates = nodePage.rows.map((row) => exportNodeRecord(query.sessionId, row))
    const page = byteBoundedPage({
      candidates,
      hasAdditionalCandidates: nodePage.hasMore,
      emptyResponse: sessionQueryResponse(request, { ...baseOutcome, records: [] }),
    })
    if (!page.accepted) {
      return sessionQueryResponse(request, {
        operation: 'export',
        error: {
          code: 'record_too_large',
          message: 'An export record exceeds the maximum Session query response size.',
        },
      })
    }
    const last = page.records.at(-1)
    return sessionQueryResponse(request, {
      ...baseOutcome,
      records: page.records,
      ...(page.hasMore && last ? { nextCreatedOrder: last.createdOrder } : {}),
    })
  }).pipe(sql.withTransaction)
}
