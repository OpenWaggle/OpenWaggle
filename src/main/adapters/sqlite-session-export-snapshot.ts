import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionExportBranchScope } from '@shared/types/session-export'
import type { SessionQueryRequest } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { resolveSelectedBranchSnapshotHead } from './sqlite-session-branch-snapshot'

export interface ExportSnapshotRow {
  readonly title: string
  readonly last_active_branch_id: string | null
  readonly state_revision: number
  readonly queue_state: 'running' | 'paused'
  readonly queue_revision: number
  readonly active_run_id: string | null
  readonly node_mutation_revision: number
  readonly node_high_water_mark: number
}

type ExportSnapshotRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { operation: 'export' }>
}

export function readExportSnapshot(sql: SqlClient.SqlClient, request: ExportSnapshotRequest) {
  const query = request.query
  const fixedHighWaterMark =
    query.snapshotManifest?.snapshot.nodeHighWaterMark ?? query.throughCreatedOrder
  if (fixedHighWaterMark !== undefined) {
    return sql<ExportSnapshotRow>`
      SELECT sessions.title, sessions.last_active_branch_id,
        session_control_states.state_revision, session_control_states.queue_state,
        session_control_states.queue_revision, session_control_states.active_run_id,
        session_control_states.node_mutation_revision,
        ${fixedHighWaterMark} AS node_high_water_mark
      FROM sessions
      JOIN session_control_states ON session_control_states.session_id = sessions.id
      WHERE sessions.id = ${query.sessionId}
    `
  }
  return sql<ExportSnapshotRow>`
    SELECT sessions.title, sessions.last_active_branch_id,
      session_control_states.state_revision, session_control_states.queue_state,
      session_control_states.queue_revision, session_control_states.active_run_id,
      session_control_states.node_mutation_revision,
      COALESCE((
        SELECT MAX(nodes.created_order)
        FROM session_nodes AS nodes
        WHERE nodes.session_id = sessions.id
      ), 0) AS node_high_water_mark
    FROM sessions
    JOIN session_control_states ON session_control_states.session_id = sessions.id
    WHERE sessions.id = ${query.sessionId}
  `
}

export function resolveExportSnapshotHead(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly branchScope: SessionExportBranchScope
    readonly selectedBranchId: string | null
    readonly suppliedHeadNodeId?: string
  },
) {
  return Effect.gen(function* () {
    if (input.branchScope === 'tree') {
      return input.suppliedHeadNodeId
        ? { status: 'not-found' as const, message: 'Tree exports do not select a branch head.' }
        : { status: 'ready' as const, headNodeId: null, branchHeadNodeId: null }
    }
    if (!input.selectedBranchId) {
      return { status: 'not-found' as const, message: 'Session branch not found.' }
    }
    const branch = yield* resolveSelectedBranchSnapshotHead(sql, {
      sessionId: input.sessionId,
      selectedBranchId: input.selectedBranchId,
      ...(input.suppliedHeadNodeId ? { suppliedHeadNodeId: input.suppliedHeadNodeId } : {}),
    })
    return branch.status === 'ready'
      ? branch
      : {
          status: 'not-found' as const,
          message: input.suppliedHeadNodeId
            ? 'Session export snapshot head does not belong to the selected branch.'
            : 'Session branch not found.',
        }
  })
}
