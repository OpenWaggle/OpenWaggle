import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { ExportSelectedPathSnapshotIdentity } from './session-export-selected-path-cache'

export interface ExportSelectedPathIdentity {
  readonly exportOperationId: string
  readonly sessionId: string
  readonly selectedBranchId: string
  readonly selectedHeadNodeId: string
  readonly nodeMutationRevision: number
}

interface SelectedPathCreatedOrderRow {
  readonly created_order: number
}

interface ChangesRow {
  readonly changes: number
}

function selectedPathIdentityMatches(
  sql: SqlClient.SqlClient,
  identity: ExportSelectedPathIdentity,
) {
  return sql<{ readonly found: number }>`
    SELECT EXISTS (
      SELECT 1
      FROM session_export_selected_paths AS selected_path
      JOIN session_export_operations AS operation
        ON operation.id = selected_path.export_operation_id
      WHERE selected_path.export_operation_id = ${identity.exportOperationId}
        AND selected_path.session_id = ${identity.sessionId}
        AND selected_path.selected_branch_id = ${identity.selectedBranchId}
        AND selected_path.selected_head_node_id = ${identity.selectedHeadNodeId}
        AND selected_path.node_mutation_revision = ${identity.nodeMutationRevision}
        AND operation.session_id = ${identity.sessionId}
        AND operation.branch_scope = ${'active-branch'}
        AND (operation.branch_id IS NULL OR operation.branch_id = ${identity.selectedBranchId})
        AND operation.status IN (${'running'}, ${'cancelling'})
    ) AS found
  `.pipe(Effect.map((rows) => rows[0]?.found === 1))
}

export function hasMaterializedExportSelectedPath(
  sql: SqlClient.SqlClient,
  identity: ExportSelectedPathIdentity,
) {
  return selectedPathIdentityMatches(sql, identity)
}

export function readExportSelectedPathCreatedOrders(
  sql: SqlClient.SqlClient,
  identity: ExportSelectedPathSnapshotIdentity,
  limit: number,
) {
  return sql<SelectedPathCreatedOrderRow>`
    WITH RECURSIVE selected_path(id) AS (
      SELECT id
      FROM session_nodes
      WHERE id = ${identity.selectedHeadNodeId} AND session_id = ${identity.sessionId}
      UNION
      SELECT nodes.parent_id
      FROM session_nodes AS nodes
      JOIN selected_path ON selected_path.id = nodes.id
      WHERE nodes.parent_id IS NOT NULL AND nodes.session_id = ${identity.sessionId}
    )
    SELECT nodes.created_order
    FROM session_nodes AS nodes
    JOIN selected_path ON selected_path.id = nodes.id
    WHERE nodes.session_id = ${identity.sessionId}
    ORDER BY nodes.created_order
    LIMIT ${limit + 1}
  `.pipe(Effect.map((rows) => rows.map((row) => row.created_order)))
}

export function ensureMaterializedExportSelectedPath(
  sql: SqlClient.SqlClient,
  identity: ExportSelectedPathIdentity,
  materializedAt: number,
) {
  return Effect.gen(function* () {
    if (yield* selectedPathIdentityMatches(sql, identity)) return

    yield* sql`
      DELETE FROM session_export_selected_paths
      WHERE export_operation_id = ${identity.exportOperationId}
    `
    yield* sql`
      INSERT INTO session_export_selected_paths (
        export_operation_id, session_id, selected_branch_id, selected_head_node_id,
        node_mutation_revision, materialized_at
      )
      SELECT operation.id, operation.session_id,
        ${identity.selectedBranchId}, ${identity.selectedHeadNodeId},
        ${identity.nodeMutationRevision}, ${materializedAt}
      FROM session_export_operations AS operation
      JOIN session_nodes AS head
        ON head.id = ${identity.selectedHeadNodeId} AND head.session_id = ${identity.sessionId}
      WHERE operation.id = ${identity.exportOperationId}
        AND operation.session_id = ${identity.sessionId}
        AND operation.branch_scope = ${'active-branch'}
        AND (operation.branch_id IS NULL OR operation.branch_id = ${identity.selectedBranchId})
        AND operation.status IN (${'running'}, ${'cancelling'})
    `
    const inserted = (yield* sql<ChangesRow>`SELECT changes() AS changes`)[0]?.changes ?? 0
    if (inserted !== 1) {
      return yield* Effect.fail(
        new Error('Export selected path does not belong to an active export operation.'),
      )
    }
    yield* sql`
      WITH RECURSIVE selected_path(id) AS (
        SELECT id
        FROM session_nodes
        WHERE id = ${identity.selectedHeadNodeId} AND session_id = ${identity.sessionId}
        UNION
        SELECT nodes.parent_id
        FROM session_nodes AS nodes
        JOIN selected_path ON selected_path.id = nodes.id
        WHERE nodes.parent_id IS NOT NULL AND nodes.session_id = ${identity.sessionId}
      )
      INSERT INTO session_export_selected_path_nodes (
        export_operation_id, created_order, node_id
      )
      SELECT ${identity.exportOperationId}, nodes.created_order, nodes.id
      FROM session_nodes AS nodes
      JOIN selected_path ON selected_path.id = nodes.id
      WHERE nodes.session_id = ${identity.sessionId}
      ORDER BY nodes.created_order
    `
  })
}
