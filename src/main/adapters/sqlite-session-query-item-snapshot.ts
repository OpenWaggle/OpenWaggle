import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'

interface ItemSnapshotRow {
  readonly session_exists: number
  readonly last_active_branch_id: string | null
  readonly high_water_mark: number
}

interface ItemSnapshotQuery {
  readonly sessionId: string
  readonly branchScope?: 'active-branch' | 'tree'
  readonly branchId?: string
  readonly snapshotHeadNodeId?: string
  readonly throughCreatedOrder?: number
}

export function resolveItemSnapshotHead(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly selectedBranchId: string | null
    readonly suppliedHeadNodeId?: string
  },
) {
  const suppliedHeadNodeId = input.suppliedHeadNodeId
  if (suppliedHeadNodeId) {
    return sql<{ readonly found: number }>`
      SELECT EXISTS(
        SELECT 1 FROM session_nodes
        WHERE id = ${suppliedHeadNodeId} AND session_id = ${input.sessionId}
      ) AS found
    `.pipe(
      Effect.map((rows) =>
        rows[0]?.found === 1
          ? ({ status: 'ready', headNodeId: suppliedHeadNodeId } as const)
          : ({ status: 'not-found' } as const),
      ),
    )
  }
  if (!input.selectedBranchId) {
    return Effect.succeed({ status: 'ready', headNodeId: null } as const)
  }
  return sql<{ readonly head_node_id: string | null }>`
    SELECT head_node_id FROM session_branches
    WHERE id = ${input.selectedBranchId} AND session_id = ${input.sessionId}
    LIMIT 1
  `.pipe(
    Effect.map((rows) =>
      rows[0]
        ? ({ status: 'ready', headNodeId: rows[0].head_node_id } as const)
        : ({ status: 'not-found' } as const),
    ),
  )
}

export function resolveItemSnapshot(sql: SqlClient.SqlClient, query: ItemSnapshotQuery) {
  return Effect.gen(function* () {
    const sessionRows = yield* sql<ItemSnapshotRow>`
      SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ${query.sessionId}) AS session_exists,
        (SELECT last_active_branch_id FROM sessions WHERE id = ${query.sessionId})
          AS last_active_branch_id,
        COALESCE(MAX(created_order), 0) AS high_water_mark
      FROM session_nodes
      WHERE session_id = ${query.sessionId}
    `
    const snapshot = sessionRows[0]
    if (snapshot?.session_exists !== 1) return { status: 'session-not-found' } as const
    const branchScope = query.branchScope ?? 'active-branch'
    const selectedBranchId =
      branchScope === 'tree' ? null : (query.branchId ?? snapshot.last_active_branch_id)
    const head =
      branchScope === 'tree'
        ? ({ status: 'ready', headNodeId: null } as const)
        : yield* resolveItemSnapshotHead(sql, {
            sessionId: query.sessionId,
            selectedBranchId,
            ...(query.snapshotHeadNodeId ? { suppliedHeadNodeId: query.snapshotHeadNodeId } : {}),
          })
    if (head.status === 'not-found') return { status: 'branch-not-found' } as const
    return {
      status: 'ready',
      branchScope,
      selectedBranchId,
      headNodeId: head.headNodeId,
      highWaterMark: query.throughCreatedOrder ?? snapshot.high_water_mark,
    } as const
  })
}
