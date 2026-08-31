import { SESSION_EXPORT_SCHEMA_VERSION } from '@shared/types/session-export'
import type { SessionQueryRequest } from '@shared/types/session-query'
import { parseSessionJson } from './sqlite-session-query-support'

type ExportRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { operation: 'export' }>
}

interface ExportSnapshot {
  readonly title: string
  readonly last_active_branch_id: string | null
  readonly queue_state: 'running' | 'paused'
  readonly queue_revision: number
  readonly active_run_id: string | null
}

interface ExportQueueItem {
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

export function exportBaseOutcome(input: {
  readonly request: ExportRequest
  readonly snapshot: ExportSnapshot
  readonly selectedBranchId: string | null
  readonly branchScope: 'active-branch' | 'tree'
  readonly highWaterMark: number
  readonly stateRevision: number
  readonly capturedAt: number
  readonly selectedHeadNodeId: string | null
  readonly queueRows: readonly ExportQueueItem[]
}) {
  const { query } = input.request
  if (query.snapshotManifest) {
    return { operation: 'export', manifest: query.snapshotManifest } as const
  }
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
