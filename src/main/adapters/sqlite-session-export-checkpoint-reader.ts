import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { ensureCurrentExportPathCheckpoints } from './sqlite-session-export-checkpoint-repair'

export interface ExportPathNodeSizeRow {
  readonly node_id: string
  readonly created_order: number
  readonly estimated_bytes: number
  readonly path_read_steps: number
}

export interface ExportPathNodeReadInput {
  readonly sessionId: string
  readonly headNodeId: string | null
  readonly afterCreatedOrder: number
  readonly throughCreatedOrder: number
  readonly limit: number
}

export const EXPORT_NODE_ESTIMATE_OVERHEAD_BYTES = 4_096

function checkpointBoundaryCtes(sql: SqlClient.SqlClient, input: ExportPathNodeReadInput) {
  return sql`
    path_index(topology_revision) AS (
        SELECT topology_revision
        FROM session_export_path_index_states
        WHERE session_id = ${input.sessionId}
      ),
      through_seek(id, parent_id, path_depth, created_order, step) AS (
        SELECT id, parent_id, path_depth, created_order, 0
        FROM session_nodes
        WHERE id = ${input.headNodeId} AND session_id = ${input.sessionId}
        UNION ALL
        SELECT next.id, next.parent_id, next.path_depth, next.created_order, current.step + 1
        FROM through_seek AS current
        JOIN session_nodes AS parent
          ON parent.id = current.parent_id AND parent.session_id = ${input.sessionId}
        LEFT JOIN session_export_path_checkpoints AS checkpoint
          ON checkpoint.node_id = current.id
          AND checkpoint.session_id = ${input.sessionId}
          AND checkpoint.path_depth = current.path_depth
          AND checkpoint.topology_revision = (SELECT topology_revision FROM path_index)
        LEFT JOIN session_nodes AS jump
          ON jump.id = checkpoint.jump_checkpoint_node_id
          AND jump.session_id = ${input.sessionId}
        LEFT JOIN session_nodes AS checkpoint_parent
          ON checkpoint_parent.id = checkpoint.parent_checkpoint_node_id
          AND checkpoint_parent.session_id = ${input.sessionId}
        JOIN session_nodes AS next
          ON next.id = CASE
            WHEN jump.id <> current.id
              AND jump.created_order > ${input.throughCreatedOrder} THEN jump.id
            WHEN checkpoint_parent.id <> current.id
              AND checkpoint_parent.created_order > ${input.throughCreatedOrder}
              THEN checkpoint_parent.id
            ELSE parent.id
          END
          AND next.session_id = ${input.sessionId}
        WHERE current.created_order > ${input.throughCreatedOrder}
      ),
      bounded_head AS (
        SELECT id, parent_id, path_depth, created_order
        FROM through_seek
        WHERE created_order <= ${input.throughCreatedOrder}
        ORDER BY step DESC
        LIMIT 1
      ),
      after_seek(id, parent_id, path_depth, created_order, step) AS (
        SELECT id, parent_id, path_depth, created_order, 0
        FROM bounded_head
        WHERE created_order > ${input.afterCreatedOrder}
        UNION ALL
        SELECT next.id, next.parent_id, next.path_depth, next.created_order, current.step + 1
        FROM after_seek AS current
        JOIN session_nodes AS parent
          ON parent.id = current.parent_id AND parent.session_id = ${input.sessionId}
        LEFT JOIN session_export_path_checkpoints AS checkpoint
          ON checkpoint.node_id = current.id
          AND checkpoint.session_id = ${input.sessionId}
          AND checkpoint.path_depth = current.path_depth
          AND checkpoint.topology_revision = (SELECT topology_revision FROM path_index)
        LEFT JOIN session_nodes AS jump
          ON jump.id = checkpoint.jump_checkpoint_node_id
          AND jump.session_id = ${input.sessionId}
        LEFT JOIN session_nodes AS checkpoint_parent
          ON checkpoint_parent.id = checkpoint.parent_checkpoint_node_id
          AND checkpoint_parent.session_id = ${input.sessionId}
        JOIN session_nodes AS next
          ON next.id = CASE
            WHEN jump.id <> current.id
              AND jump.created_order > ${input.afterCreatedOrder} THEN jump.id
            WHEN checkpoint_parent.id <> current.id
              AND checkpoint_parent.created_order > ${input.afterCreatedOrder}
              THEN checkpoint_parent.id
            ELSE parent.id
          END
          AND next.session_id = ${input.sessionId}
        WHERE parent.created_order > ${input.afterCreatedOrder}
      ),
      page_start AS (
        SELECT id, parent_id, path_depth, created_order
        FROM after_seek
        ORDER BY step DESC
        LIMIT 1
      )
  `
}

function checkpointPageCtes(sql: SqlClient.SqlClient, input: ExportPathNodeReadInput) {
  return sql`
    page_target(path_depth) AS (
      SELECT MIN(bounded_head.path_depth, page_start.path_depth + ${input.limit})
      FROM bounded_head
      JOIN page_start
    ),
    end_seek(id, parent_id, path_depth, created_order, step) AS (
        SELECT id, parent_id, path_depth, created_order, 0
        FROM bounded_head
        UNION ALL
        SELECT next.id, next.parent_id, next.path_depth, next.created_order, current.step + 1
        FROM end_seek AS current
        JOIN page_target
        JOIN session_nodes AS parent
          ON parent.id = current.parent_id AND parent.session_id = ${input.sessionId}
        LEFT JOIN session_export_path_checkpoints AS checkpoint
          ON checkpoint.node_id = current.id
          AND checkpoint.session_id = ${input.sessionId}
          AND checkpoint.path_depth = current.path_depth
          AND checkpoint.topology_revision = (SELECT topology_revision FROM path_index)
        LEFT JOIN session_nodes AS jump
          ON jump.id = checkpoint.jump_checkpoint_node_id
          AND jump.session_id = ${input.sessionId}
        LEFT JOIN session_nodes AS checkpoint_parent
          ON checkpoint_parent.id = checkpoint.parent_checkpoint_node_id
          AND checkpoint_parent.session_id = ${input.sessionId}
        JOIN session_nodes AS next
          ON next.id = CASE
            WHEN jump.id <> current.id AND jump.path_depth >= page_target.path_depth THEN jump.id
            WHEN checkpoint_parent.id <> current.id
              AND checkpoint_parent.path_depth >= page_target.path_depth
              THEN checkpoint_parent.id
            ELSE parent.id
          END
          AND next.session_id = ${input.sessionId}
        WHERE current.path_depth > page_target.path_depth
      ),
      page_end AS (
        SELECT id, parent_id, path_depth, created_order
        FROM end_seek
        ORDER BY step DESC
        LIMIT 1
      ),
      page_path(id, parent_id, path_depth, created_order, step) AS (
        SELECT id, parent_id, path_depth, created_order, 0
        FROM page_end
        UNION ALL
        SELECT parent.id, parent.parent_id, parent.path_depth, parent.created_order,
          current.step + 1
        FROM page_path AS current
        JOIN page_start
        JOIN session_nodes AS parent
          ON parent.id = current.parent_id AND parent.session_id = ${input.sessionId}
        WHERE current.path_depth > page_start.path_depth
      ),
      read_work(path_read_steps) AS (
        SELECT
          COALESCE((SELECT MAX(step) + 1 FROM through_seek), 0) +
          COALESCE((SELECT MAX(step) + 1 FROM after_seek), 0) +
          COALESCE((SELECT MAX(step) + 1 FROM end_seek), 0) +
          COALESCE((SELECT MAX(step) + 1 FROM page_path), 0)
      )
  `
}

export function readCheckpointedExportNodeSizes(
  sql: SqlClient.SqlClient,
  input: ExportPathNodeReadInput,
) {
  return Effect.gen(function* () {
    while (true) {
      yield* ensureCurrentExportPathCheckpoints(sql, input.sessionId)
      const rows = yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* sql<{ readonly ready: number }>`
          SELECT 1 AS ready FROM session_export_path_index_states
          WHERE session_id = ${input.sessionId}
            AND topology_revision = indexed_topology_revision
        `
          if (current.length === 0) return undefined
          return yield* sql<ExportPathNodeSizeRow>`
      WITH RECURSIVE
        ${checkpointBoundaryCtes(sql, input)},
        ${checkpointPageCtes(sql, input)}
      SELECT nodes.id AS node_id, nodes.created_order,
        length(CAST(nodes.content_json AS BLOB)) + length(CAST(nodes.metadata_json AS BLOB)) +
          ${EXPORT_NODE_ESTIMATE_OVERHEAD_BYTES} AS estimated_bytes,
        read_work.path_read_steps
      FROM page_path
      JOIN session_nodes AS nodes
        ON nodes.id = page_path.id AND nodes.session_id = ${input.sessionId}
      JOIN read_work
      ORDER BY nodes.created_order ASC
      LIMIT ${input.limit + 1}
        `
        }),
      )
      if (rows !== undefined) return rows
      yield* Effect.yieldNow()
    }
  })
}
