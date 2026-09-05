import type * as SqlClient from '@effect/sql/SqlClient'
import { sessionExportBranchSelectionIsValid } from '@shared/session-export-selection'
import type { SessionQueryRequest } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { byteBoundedPage } from './session-query-byte-pagination'
import { exportContinuationMatchesSnapshot } from './sqlite-session-export-continuation'
import { exportBaseOutcome } from './sqlite-session-export-manifest'
import { exportNodeReadStrategy, readExportNodes } from './sqlite-session-export-node-reader'
import { exportNodeRecord } from './sqlite-session-export-record'
import { resolveExportSnapshotHead } from './sqlite-session-export-snapshot'
import { sessionQueryResponse } from './sqlite-session-query-support'

type ExportRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { operation: 'export' }>
}

interface ExportSnapshotRow {
  readonly title: string
  readonly last_active_branch_id: string | null
  readonly state_revision: number
  readonly queue_state: 'running' | 'paused'
  readonly queue_revision: number
  readonly active_run_id: string | null
  readonly node_mutation_revision: number
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
    if (
      !exportContinuationMatchesSnapshot({
        query,
        branchScope,
        nodeMutationRevision: snapshot.node_mutation_revision,
      })
    ) {
      return yield* Effect.fail(new Error('EXPORT_SNAPSHOT_MISMATCH'))
    }
    const selectedBranchId =
      query.branchId ?? query.snapshotManifest?.selectedBranchId ?? snapshot.last_active_branch_id
    const suppliedHeadNodeId =
      query.snapshotManifest?.snapshot.selectedHeadNodeId ?? query.snapshotHeadNodeId
    const head = yield* resolveExportSnapshotHead(sql, {
      sessionId: query.sessionId,
      branchScope,
      selectedBranchId,
      ...(suppliedHeadNodeId ? { suppliedHeadNodeId } : {}),
    })
    if (head.status === 'not-found') return yield* Effect.fail(new Error(head.message))
    return {
      branchScope,
      selectedBranchId,
      selectedHeadNodeId: head.headNodeId,
      branchHeadNodeId: head.branchHeadNodeId,
    }
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
        session_control_states.node_mutation_revision,
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
    const { branchScope, selectedBranchId, selectedHeadNodeId, branchHeadNodeId } = selection.right
    const readStrategy = exportNodeReadStrategy({
      tree: branchScope === 'tree',
      selectedBranchId,
      activeBranchId: snapshot.last_active_branch_id,
      selectedHeadNodeId,
      branchHeadNodeId,
    })
    const queueRows = query.snapshotManifest
      ? []
      : yield* sql<ExportQueueRow>`
          SELECT id, position, delivery_state, attention_reason, intent_json, created_at
          FROM session_follow_ups
          WHERE session_id = ${query.sessionId}
          ORDER BY position, id
        `
    const highWaterMark =
      query.snapshotManifest?.snapshot.nodeHighWaterMark ??
      query.throughCreatedOrder ??
      snapshot.node_high_water_mark
    const stateRevision =
      query.snapshotManifest?.snapshot.stateRevision ??
      query.snapshotStateRevision ??
      snapshot.state_revision
    const capturedAt = query.snapshotManifest?.snapshot.capturedAt ?? query.capturedAt ?? Date.now()
    const nodePage = yield* readExportNodes(sql, {
      sessionId: query.sessionId,
      headNodeId: selectedHeadNodeId,
      tree: branchScope === 'tree',
      indexedBranchId: readStrategy === 'indexed-active-branch' ? selectedBranchId : null,
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
