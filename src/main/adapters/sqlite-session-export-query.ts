import type * as SqlClient from '@effect/sql/SqlClient'
import { sessionExportBranchSelectionIsValid } from '@shared/session-export-selection'
import {
  SESSION_QUERY_MAX_RESPONSE_BYTES,
  type SessionQueryRequest,
} from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import {
  byteBoundedPage,
  SESSION_QUERY_SQL_READ_BUDGET_BYTES,
} from './session-query-byte-pagination'
import { exportBaseOutcome } from './sqlite-session-export-manifest'
import { type ExportNodeRow, exportNodeRecord } from './sqlite-session-export-record'
import { resolveExportSnapshotHead } from './sqlite-session-export-snapshot'
import { sessionQueryResponse } from './sqlite-session-query-support'

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

function continuationMatchesSnapshot(
  query: ExportRequest['query'],
  branchScope: 'active-branch' | 'tree',
) {
  const manifest = query.snapshotManifest
  return (
    !manifest ||
    (manifest.sessionId === query.sessionId &&
      manifest.branchScope === branchScope &&
      manifest.snapshot.nodeHighWaterMark === query.throughCreatedOrder &&
      manifest.snapshot.stateRevision === query.snapshotStateRevision &&
      manifest.snapshot.capturedAt === query.capturedAt &&
      manifest.snapshot.selectedHeadNodeId === query.snapshotHeadNodeId &&
      (branchScope === 'tree' || !query.branchId || manifest.selectedBranchId === query.branchId) &&
      manifest.queue.bodyScope === (query.includeQueueBodies ? 'included' : 'omitted-by-choice'))
  )
}

function exportSelection(
  sql: SqlClient.SqlClient,
  request: ExportRequest,
  snapshot: ExportSnapshotRow,
) {
  const query = request.query
  return Effect.gen(function* () {
    const branchScope = query.branchScope ?? 'active-branch'
    if (!sessionExportBranchSelectionIsValid({ branchScope, branchId: query.branchId })) {
      return yield* Effect.fail(
        new Error('A Session branch can be selected only for an active-branch export.'),
      )
    }
    if (!continuationMatchesSnapshot(query, branchScope)) {
      return yield* Effect.fail(new Error('EXPORT_SNAPSHOT_MISMATCH'))
    }
    const selectedBranchId =
      query.branchId ?? query.snapshotManifest?.selectedBranchId ?? snapshot.last_active_branch_id
    const head = yield* resolveExportSnapshotHead(sql, {
      sessionId: query.sessionId,
      branchScope,
      selectedBranchId,
      ...(query.snapshotHeadNodeId ? { suppliedHeadNodeId: query.snapshotHeadNodeId } : {}),
    })
    if (head.status === 'not-found') return yield* Effect.fail(new Error(head.message))
    return { branchScope, selectedBranchId, selectedHeadNodeId: head.headNodeId }
  })
}

function exportErrorResponse(
  request: ExportRequest,
  code: 'record_too_large' | 'resync_required',
  message: string,
) {
  return sessionQueryResponse(request, { operation: 'export', error: { code, message } })
}

function renderExportNodePage(
  request: ExportRequest,
  baseOutcome: ReturnType<typeof exportBaseOutcome>,
  nodePage: Effect.Effect.Success<ReturnType<typeof readExportNodes>>,
) {
  const tooLarge = () =>
    exportErrorResponse(
      request,
      'record_too_large',
      'An export record exceeds the maximum Session query response size.',
    )
  if (nodePage.oversized) return tooLarge()
  const candidates = nodePage.rows.map((row) => exportNodeRecord(request.query.sessionId, row))
  const page = byteBoundedPage({
    candidates,
    hasAdditionalCandidates: nodePage.hasMore,
    emptyResponse: sessionQueryResponse(request, { ...baseOutcome, records: [] }),
  })
  if (!page.accepted) return tooLarge()
  const last = page.records.at(-1)
  return sessionQueryResponse(request, {
    ...baseOutcome,
    records: page.records,
    ...(page.hasMore && last ? { nextCreatedOrder: last.createdOrder } : {}),
  })
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
    const selection = yield* exportSelection(sql, request, snapshot).pipe(
      Effect.mapError((error) =>
        error.message === 'EXPORT_SNAPSHOT_MISMATCH'
          ? exportErrorResponse(
              request,
              'resync_required',
              'Export continuation metadata does not match its immutable manifest.',
            )
          : sessionQueryResponse(request, {
              operation: 'export',
              error: { code: 'branch_not_found', message: error.message },
            }),
      ),
      Effect.either,
    )
    if (selection._tag === 'Left') return selection.left
    const { branchScope, selectedBranchId, selectedHeadNodeId } = selection.right
    const queueRows = query.snapshotManifest
      ? []
      : yield* sql<ExportQueueRow>`
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
    return renderExportNodePage(request, baseOutcome, nodePage)
  }).pipe(sql.withTransaction)
}
