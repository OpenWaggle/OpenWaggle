import type * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_EXPORT_SCHEMA_VERSION } from '@shared/types/session-export'
import type { SessionQueryRequest } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { parseSessionJson, sessionQueryResponse } from './sqlite-session-query-support'

type ExportRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { operation: 'export' }>
}

interface ExportNodeRow {
  readonly id: string
  readonly parent_id: string | null
  readonly branch_hint_id: string | null
  readonly role: string | null
  readonly kind: string
  readonly timestamp_ms: number
  readonly created_order: number
  readonly content_json: string
  readonly metadata_json: string
}

function runIdFromMetadata(metadata: unknown) {
  if (typeof metadata !== 'object' || metadata === null || !('openWaggle' in metadata)) {
    return undefined
  }
  const openWaggle = metadata.openWaggle
  if (typeof openWaggle !== 'object' || openWaggle === null || !('runId' in openWaggle)) {
    return undefined
  }
  return typeof openWaggle.runId === 'string' ? openWaggle.runId : undefined
}

function readExportNodes(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly branchId: string | null
    readonly tree: boolean
    readonly afterCreatedOrder: number
    readonly throughCreatedOrder: number
    readonly limit: number
  },
) {
  if (input.tree) {
    return sql<ExportNodeRow>`
      SELECT id, parent_id, branch_hint_id, role, kind, timestamp_ms, created_order,
        content_json, metadata_json
      FROM session_nodes
      WHERE session_id = ${input.sessionId}
        AND created_order > ${input.afterCreatedOrder}
        AND created_order <= ${input.throughCreatedOrder}
      ORDER BY created_order ASC
      LIMIT ${input.limit + 1}
    `
  }
  if (!input.branchId) {
    const empty: readonly ExportNodeRow[] = []
    return Effect.succeed(empty)
  }
  return sql<ExportNodeRow>`
    WITH RECURSIVE selected_path(id) AS (
      SELECT head_node_id FROM session_branches
      WHERE id = ${input.branchId} AND session_id = ${input.sessionId}
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
      AND nodes.created_order <= ${input.throughCreatedOrder}
    ORDER BY nodes.created_order ASC
    LIMIT ${input.limit + 1}
  `
}

function selectedBranchExists(
  sql: SqlClient.SqlClient,
  sessionId: string,
  branchId: string | null,
) {
  if (!branchId) return Effect.succeed(true)
  return sql<{ readonly found: number }>`
    SELECT EXISTS(
      SELECT 1 FROM session_branches WHERE id = ${branchId} AND session_id = ${sessionId}
    ) AS found
  `.pipe(Effect.map((rows) => rows[0]?.found === 1))
}

function exportNodeRecord(sessionId: string, row: ExportNodeRow) {
  const metadata = parseSessionJson(row.metadata_json)
  const runId = runIdFromMetadata(metadata)
  return {
    record: 'node' as const,
    schemaVersion: SESSION_EXPORT_SCHEMA_VERSION,
    sessionId,
    nodeId: row.id,
    parentNodeId: row.parent_id,
    branchHintId: row.branch_hint_id,
    role: row.role,
    kind: row.kind,
    timestampMs: row.timestamp_ms,
    createdOrder: row.created_order,
    ...(runId ? { runId } : {}),
    content: parseSessionJson(row.content_json),
    metadata,
  }
}

export function readSessionExport(sql: SqlClient.SqlClient, request: ExportRequest) {
  const query = request.query
  return Effect.gen(function* () {
    const snapshots = yield* sql<{
      readonly title: string
      readonly last_active_branch_id: string | null
      readonly state_revision: number
      readonly queue_state: 'running' | 'paused'
      readonly queue_revision: number
      readonly active_run_id: string | null
      readonly node_high_water_mark: number
    }>`
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
    if (!(yield* selectedBranchExists(sql, query.sessionId, selectedBranchId))) {
      return sessionQueryResponse(request, {
        operation: 'export',
        error: { code: 'branch_not_found', message: 'Session branch not found.' },
      })
    }
    const queueRows = yield* sql<{
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
    }>`
      SELECT id, position, delivery_state, attention_reason, intent_json, created_at
      FROM session_follow_ups
      WHERE session_id = ${query.sessionId}
      ORDER BY position, id
    `
    const highWaterMark = query.throughCreatedOrder ?? snapshot.node_high_water_mark
    const stateRevision = query.snapshotStateRevision ?? snapshot.state_revision
    const capturedAt = query.capturedAt ?? Date.now()
    const rows = yield* readExportNodes(sql, {
      sessionId: query.sessionId,
      branchId: selectedBranchId,
      tree: branchScope === 'tree',
      afterCreatedOrder: query.afterCreatedOrder ?? -1,
      throughCreatedOrder: highWaterMark,
      limit: query.limit,
    })
    const page = rows.slice(0, query.limit)
    const last = page.at(-1)
    return sessionQueryResponse(request, {
      operation: 'export',
      manifest: {
        schemaVersion: SESSION_EXPORT_SCHEMA_VERSION,
        sessionId: query.sessionId,
        title: snapshot.title,
        branchScope,
        activeBranchId: snapshot.last_active_branch_id,
        selectedBranchId: branchScope === 'tree' ? null : selectedBranchId,
        snapshot: {
          nodeHighWaterMark: highWaterMark,
          stateRevision,
          queueRevision: snapshot.queue_revision,
          capturedAt,
        },
        activeRunId: snapshot.active_run_id,
        activeTurnIncomplete: snapshot.active_run_id !== null,
        queue: {
          state: snapshot.queue_state,
          pendingCount: queueRows.length,
          bodyScope: query.includeQueueBodies ? 'included' : 'omitted-by-choice',
          omittedBodyCount: query.includeQueueBodies ? 0 : queueRows.length,
          items: queueRows.map((row) => ({
            followUpId: row.id,
            position: row.position,
            createdAt: row.created_at,
            deliveryState: row.delivery_state,
            ...(row.attention_reason ? { attentionReason: row.attention_reason } : {}),
            ...(query.includeQueueBodies ? { intent: parseSessionJson(row.intent_json) } : {}),
          })),
        },
      },
      records: page.map((row) => exportNodeRecord(query.sessionId, row)),
      ...(rows.length > query.limit && last ? { nextCreatedOrder: last.created_order } : {}),
    })
  }).pipe(sql.withTransaction)
}
