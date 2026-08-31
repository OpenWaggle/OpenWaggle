import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionExportBranchScope } from '@shared/types/session-export'
import * as Effect from 'effect/Effect'

interface SelectedBranchRow {
  readonly head_node_id: string | null
}

function selectedBranch(sql: SqlClient.SqlClient, sessionId: string, branchId: string | null) {
  if (!branchId) return Effect.succeed<SelectedBranchRow | undefined>(undefined)
  return sql<SelectedBranchRow>`
    SELECT head_node_id FROM session_branches
    WHERE id = ${branchId} AND session_id = ${sessionId}
    LIMIT 1
  `.pipe(Effect.map((rows) => rows[0]))
}

function snapshotHeadExists(sql: SqlClient.SqlClient, sessionId: string, headNodeId: string) {
  return sql<{ readonly found: number }>`
    SELECT EXISTS(
      SELECT 1 FROM session_nodes WHERE id = ${headNodeId} AND session_id = ${sessionId}
    ) AS found
  `.pipe(Effect.map((rows) => rows[0]?.found === 1))
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
      return { status: 'ready' as const, headNodeId: null }
    }
    if (input.suppliedHeadNodeId) {
      const exists = yield* snapshotHeadExists(sql, input.sessionId, input.suppliedHeadNodeId)
      return exists
        ? { status: 'ready' as const, headNodeId: input.suppliedHeadNodeId }
        : { status: 'not-found' as const, message: 'Session export snapshot head not found.' }
    }
    const branch = yield* selectedBranch(sql, input.sessionId, input.selectedBranchId)
    return branch
      ? { status: 'ready' as const, headNodeId: branch.head_node_id }
      : { status: 'not-found' as const, message: 'Session branch not found.' }
  })
}
