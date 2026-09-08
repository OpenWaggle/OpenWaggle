import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SESSION_EXPORT_PATH_CHECKPOINT_STRIDE } from '../services/session-host-export-schema'

interface ExportPathIndexStateRow {
  readonly indexed_topology_revision: number
  readonly topology_revision: number
  readonly building_topology_revision: number
  readonly building_created_order: number
  readonly building_node_id: string
}

interface CheckpointCandidateRow {
  readonly id: string
  readonly session_id: string
  readonly parent_id: string | null
  readonly path_depth: number
  readonly created_order: number
}

interface DeletedCheckpointRow {
  readonly node_id: string
}

const CHECKPOINT_REPAIR_BATCH_SIZE = 128
const CHECKPOINT_SOURCE_BATCH_SIZE = 2_048
const CHECKPOINT_CLEANUP_BATCH_SIZE = 256

function readExportPathIndexState(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<ExportPathIndexStateRow>`
    SELECT topology_revision, indexed_topology_revision, building_topology_revision,
      building_created_order, building_node_id
    FROM session_export_path_index_states
    WHERE session_id = ${sessionId}
    LIMIT 1
  `.pipe(Effect.map((rows) => rows[0]))
}

function pathIndexIsCurrent(state: ExportPathIndexStateRow) {
  return state.indexed_topology_revision === state.topology_revision
}

function missingPathIndexState() {
  return new Error('Export path index state is missing for the Session.')
}

function cleanupCheckpointBatch(sql: SqlClient.SqlClient, sessionId: string) {
  const deleteRevisionRange = (
    from: number,
    through: number,
    limit: number,
  ) => sql<DeletedCheckpointRow>`
    DELETE FROM session_export_path_checkpoints
    WHERE (node_id, topology_revision) IN (
      SELECT node_id, topology_revision FROM session_export_path_checkpoints
      WHERE session_id = ${sessionId}
        AND topology_revision >= ${from} AND topology_revision < ${through}
      ORDER BY topology_revision, path_depth, node_id
      LIMIT ${limit}
    )
    RETURNING node_id
  `
  return sql.withTransaction(
    Effect.gen(function* () {
      // Read the revisions under the same transaction as cleanup, so another repair cannot
      // publish checkpoints between choosing the retained revisions and deleting obsolete rows.
      const state = yield* readExportPathIndexState(sql, sessionId)
      if (!state) return yield* Effect.fail(missingPathIndexState())
      const retired = yield* deleteRevisionRange(
        0,
        state.indexed_topology_revision,
        CHECKPOINT_CLEANUP_BATCH_SIZE,
      )
      const abandoned = yield* deleteRevisionRange(
        state.indexed_topology_revision + 1,
        state.topology_revision,
        CHECKPOINT_CLEANUP_BATCH_SIZE - retired.length,
      )
      return retired.length + abandoned.length
    }),
  )
}

function buildCheckpointBatch(sql: SqlClient.SqlClient, sessionId: string, targetRevision: number) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const state = yield* readExportPathIndexState(sql, sessionId)
      if (!state) return yield* Effect.fail(missingPathIndexState())
      if (state.topology_revision !== targetRevision) return 'topology-changed' as const
      const continuing = state.building_topology_revision === targetRevision
      const source = yield* sql<CheckpointCandidateRow>`
        SELECT id, session_id, parent_id, path_depth, created_order
        FROM session_nodes
        WHERE session_id = ${sessionId}
          AND (created_order, id) > (
            ${continuing ? state.building_created_order : -1},
            ${continuing ? state.building_node_id : ''}
          )
        ORDER BY created_order, id
        LIMIT ${CHECKPOINT_SOURCE_BATCH_SIZE}
      `
      const candidates = source
        .filter(
          (node) =>
            node.path_depth >= 0 && node.path_depth % SESSION_EXPORT_PATH_CHECKPOINT_STRIDE === 0,
        )
        .slice(0, CHECKPOINT_REPAIR_BATCH_SIZE)
      const cursor =
        candidates.length === CHECKPOINT_REPAIR_BATCH_SIZE ? candidates.at(-1) : source.at(-1)
      if (candidates.length > 0) {
        yield* sql`
          INSERT INTO session_export_path_checkpoint_build_input (
            node_id, session_id, parent_id, path_depth, topology_revision
          )
          SELECT id, session_id, parent_id, path_depth, ${targetRevision}
          FROM session_nodes
          WHERE id IN ${sql.in(candidates.map((candidate) => candidate.id))}
          ORDER BY created_order, id
        `
        const built = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count
          FROM session_export_path_checkpoints
          WHERE topology_revision = ${targetRevision}
            AND node_id IN ${sql.in(candidates.map((candidate) => candidate.id))}
        `
        if ((built[0]?.count ?? 0) !== candidates.length) {
          return yield* Effect.fail(
            new Error('Export path checkpoint repair could not make progress.'),
          )
        }
      }
      if (cursor) {
        yield* sql`
          UPDATE session_export_path_index_states SET
            building_topology_revision = ${targetRevision},
            building_created_order = ${cursor.created_order}, building_node_id = ${cursor.id}
          WHERE session_id = ${sessionId} AND topology_revision = ${targetRevision}
        `
      }
      if (source.length < CHECKPOINT_SOURCE_BATCH_SIZE && cursor === source.at(-1)) {
        yield* sql`
          UPDATE session_export_path_index_states
          SET indexed_topology_revision = ${targetRevision}
          WHERE session_id = ${sessionId}
            AND topology_revision = ${targetRevision}
        `
        return 'published' as const
      }
      return 'built' as const
    }),
  )
}

function repairExportPathCheckpointsStep(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const state = yield* readExportPathIndexState(sql, sessionId)
    if (!state) return yield* Effect.fail(missingPathIndexState())
    if (pathIndexIsCurrent(state)) {
      yield* cleanupCheckpointBatch(sql, sessionId)
      return true
    }
    const targetRevision = state.topology_revision
    const deleted = yield* cleanupCheckpointBatch(sql, sessionId)
    if (deleted === CHECKPOINT_CLEANUP_BATCH_SIZE) return false
    const result = yield* buildCheckpointBatch(sql, sessionId, targetRevision)
    if (result !== 'published') return false
    yield* cleanupCheckpointBatch(sql, sessionId)
    return true
  })
}

export function ensureCurrentExportPathCheckpoints(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    while (!(yield* repairExportPathCheckpointsStep(sql, sessionId))) {
      // Commit progress before yielding so cancellation and other Sessions can use the database.
      yield* Effect.yieldNow()
    }
  })
}
