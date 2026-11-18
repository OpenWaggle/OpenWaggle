import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'

interface SelectedBranchSnapshotRow {
  readonly branch_found: number
  readonly head_node_id: string | null
  readonly supplied_head_found: number
}

export function resolveSelectedBranchSnapshotHead(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly selectedBranchId: string
    readonly suppliedHeadNodeId?: string
  },
) {
  return sql<SelectedBranchSnapshotRow>`
    WITH RECURSIVE
      selected_branch AS (
        SELECT head_node_id FROM session_branches
        WHERE id = ${input.selectedBranchId} AND session_id = ${input.sessionId}
        LIMIT 1
      ),
      branch_ancestry(id, parent_id) AS (
        SELECT nodes.id, nodes.parent_id
        FROM session_nodes AS nodes
        JOIN selected_branch ON selected_branch.head_node_id = nodes.id
        WHERE nodes.session_id = ${input.sessionId}
        UNION
        SELECT parent.id, parent.parent_id
        FROM session_nodes AS parent
        JOIN branch_ancestry ON branch_ancestry.parent_id = parent.id
        WHERE parent.session_id = ${input.sessionId}
      )
    SELECT
      EXISTS(SELECT 1 FROM selected_branch) AS branch_found,
      (SELECT head_node_id FROM selected_branch) AS head_node_id,
      CASE
        WHEN ${input.suppliedHeadNodeId ?? null} IS NULL THEN 1
        ELSE EXISTS(
          SELECT 1 FROM session_nodes AS supplied
          WHERE supplied.id = ${input.suppliedHeadNodeId ?? null}
            AND supplied.session_id = ${input.sessionId}
            AND (
              supplied.branch_hint_id = ${input.selectedBranchId}
              OR supplied.id IN (SELECT id FROM branch_ancestry)
            )
        )
      END AS supplied_head_found
  `.pipe(
    Effect.map((rows) => {
      const row = rows[0]
      if (row?.branch_found !== 1 || row.supplied_head_found !== 1) {
        return { status: 'not-found' } as const
      }
      return {
        status: 'ready',
        headNodeId: input.suppliedHeadNodeId ?? row.head_node_id,
        branchHeadNodeId: row.head_node_id,
      } as const
    }),
  )
}
