import { createHash } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type { SessionResourceRouteSelection } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'

interface SessionActiveBranchRow {
  readonly last_active_branch_id: string | null
  readonly last_active_node_id: string | null
  readonly selected_branch_id: string | null
  readonly catalog_revision: number
}

export interface SessionResourceCatalogIdentity {
  readonly branch: string | null
  readonly pathNodeIds: readonly string[] | null
  readonly revision: string
}

function routePathIdentity(pathNodeIds: readonly string[]) {
  const hash = createHash('sha256')
  for (const nodeId of pathNodeIds) {
    hash.update(nodeId)
    hash.update('\0')
  }
  return hash.digest('base64url')
}

function resolvedCatalogIdentity(
  row: SessionActiveBranchRow | undefined,
  selection: SessionResourceRouteSelection | null,
): SessionResourceCatalogIdentity {
  const branch = selection
    ? (row?.selected_branch_id ?? null)
    : (row?.last_active_branch_id ?? null)
  const catalogRevision = String(row?.catalog_revision ?? 0)
  if (selection) {
    return {
      branch,
      pathNodeIds: [...selection.pathNodeIds],
      revision: `${branch ?? 'none'}:path:${routePathIdentity(selection.pathNodeIds)}:${catalogRevision}`,
    }
  }
  return {
    branch,
    pathNodeIds: null,
    revision: `${branch ?? 'none'}:${row?.last_active_node_id ?? 'none'}:${catalogRevision}`,
  }
}

export function catalogIdentity(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  selection: SessionResourceRouteSelection | null = null,
) {
  const hasSelection = selection !== null
  const selectedBranchId = selection?.branchId ?? '__openwaggle:no-selected-branch__'
  return Effect.map(
    sql<SessionActiveBranchRow>`
      SELECT
        session.last_active_branch_id,
        session.last_active_node_id,
        (
          SELECT branch.id
          FROM session_branches branch
          WHERE ${hasSelection ? 1 : 0} = 1
            AND branch.session_id = session.id
            AND branch.id = ${selectedBranchId}
          LIMIT 1
        ) AS selected_branch_id,
        COALESCE(catalog.revision, 0) AS catalog_revision
      FROM sessions session
      LEFT JOIN session_resource_catalog_state catalog ON catalog.session_id = session.id
      WHERE session.id = ${sessionId}
      LIMIT 1
    `,
    (rows) => resolvedCatalogIdentity(rows[0], selection),
  )
}

export function activeCatalogPath(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  identity: SessionResourceCatalogIdentity,
) {
  if (identity.pathNodeIds) {
    return sql`
      SELECT node.id
      FROM json_each(${JSON.stringify(identity.pathNodeIds)}) selected
      INNER JOIN session_nodes node
        ON node.id = selected.value AND node.session_id = ${sessionId}
      UNION
      SELECT node.parent_id
      FROM session_nodes node
      INNER JOIN active_path path ON node.id = path.node_id
      WHERE node.parent_id IS NOT NULL AND node.session_id = ${sessionId}
    `
  }
  return sql`
    SELECT last_active_node_id
    FROM sessions
    WHERE id = ${sessionId} AND last_active_node_id IS NOT NULL
    UNION ALL
    SELECT node.parent_id
    FROM session_nodes node
    INNER JOIN active_path path ON node.id = path.node_id
    WHERE node.parent_id IS NOT NULL AND node.session_id = ${sessionId}
  `
}
