import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SESSION_EXPORT_PATH_CHECKPOINT_STRIDE } from '../services/session-host-export-schema'

interface ExportPathIndexStateRow {
  readonly indexed_topology_revision: number
  readonly topology_revision: number
}

interface CheckpointCursorRow {
  readonly created_order: number
}

interface CheckpointCandidateRow {
  readonly id: string
  readonly session_id: string
  readonly parent_id: string | null
  readonly path_depth: number
}

interface DeletedCheckpointRow {
  readonly node_id: string
}

const CHECKPOINT_REPAIR_BATCH_SIZE = 128
const CHECKPOINT_CLEANUP_BATCH_SIZE = 256
export const EXPORT_PATH_INDEX_PREPARING_MESSAGE =
  'The selected Session path index is preparing; retry the export page.'

function readExportPathIndexState(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<ExportPathIndexStateRow>`
    SELECT topology_revision, indexed_topology_revision
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

function cleanupCheckpointBatch(
  sql: SqlClient.SqlClient,
  sessionId: string,
  keepRevisions: readonly number[],
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const deleted = yield* sql<DeletedCheckpointRow>`
        DELETE FROM session_export_path_checkpoints
        WHERE (node_id, topology_revision) IN (
          SELECT node_id, topology_revision
          FROM session_export_path_checkpoints
          WHERE session_id = ${sessionId}
            AND topology_revision NOT IN ${sql.in(keepRevisions)}
          ORDER BY topology_revision, path_depth, node_id
          LIMIT ${CHECKPOINT_CLEANUP_BATCH_SIZE}
        )
        RETURNING node_id
      `
      return deleted.length
    }),
  )
}

function buildCheckpointBatch(
  sql: SqlClient.SqlClient,
  sessionId: string,
  targetRevision: number,
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const state = yield* readExportPathIndexState(sql, sessionId)
      if (!state) return yield* Effect.fail(missingPathIndexState())
      if (state.topology_revision !== targetRevision) return 'topology-changed' as const
      const cursors = yield* sql<CheckpointCursorRow>`
        SELECT COALESCE(MAX(nodes.created_order), -1) AS created_order
        FROM session_export_path_checkpoints AS checkpoints
        JOIN session_nodes AS nodes ON nodes.id = checkpoints.node_id
        WHERE checkpoints.session_id = ${sessionId}
          AND checkpoints.topology_revision = ${targetRevision}
      `
      const cursor = cursors[0]?.created_order ?? -1
      const candidates = yield* sql<CheckpointCandidateRow>`
        SELECT id, session_id, parent_id, path_depth
        FROM session_nodes
        WHERE session_id = ${sessionId}
          AND created_order > ${cursor}
          AND path_depth >= 0
          AND path_depth % ${SESSION_EXPORT_PATH_CHECKPOINT_STRIDE} = 0
        ORDER BY created_order
        LIMIT ${CHECKPOINT_REPAIR_BATCH_SIZE}
      `
      if (candidates.length === 0) {
        yield* sql`
          UPDATE session_export_path_index_states
          SET indexed_topology_revision = ${targetRevision}
          WHERE session_id = ${sessionId}
            AND topology_revision = ${targetRevision}
        `
        return 'published' as const
      }
      yield* sql`
        INSERT INTO session_export_path_checkpoint_build_input (
          node_id, session_id, parent_id, path_depth, topology_revision
        )
        SELECT id, session_id, parent_id, path_depth, ${targetRevision}
        FROM session_nodes
        WHERE id IN ${sql.in(candidates.map((candidate) => candidate.id))}
        ORDER BY created_order
      `
      const built = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM session_export_path_checkpoints
        WHERE topology_revision = ${targetRevision}
          AND node_id IN ${sql.in(candidates.map((candidate) => candidate.id))}
      `
      if ((built[0]?.count ?? 0) !== candidates.length) {
        return yield* Effect.fail(new Error('Export path checkpoint repair could not make progress.'))
      }
      return 'built' as const
    }),
  )
}

function repairExportPathCheckpointsStep(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const state = yield* readExportPathIndexState(sql, sessionId)
    if (!state) return yield* Effect.fail(missingPathIndexState())
    if (pathIndexIsCurrent(state)) return true
    const targetRevision = state.topology_revision
    const deleted = yield* cleanupCheckpointBatch(sql, sessionId, [
      state.indexed_topology_revision,
      targetRevision,
    ])
    if (deleted === CHECKPOINT_CLEANUP_BATCH_SIZE) return false
    const result = yield* buildCheckpointBatch(sql, sessionId, targetRevision)
    if (result !== 'published') return false
    yield* cleanupCheckpointBatch(sql, sessionId, [targetRevision])
    return true
  })
}

export function ensureCurrentExportPathCheckpoints(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const state = yield* readExportPathIndexState(sql, sessionId)
    if (!state) return yield* Effect.fail(missingPathIndexState())
    if (pathIndexIsCurrent(state)) return
    const current = yield* repairExportPathCheckpointsStep(sql, sessionId)
    if (!current) return yield* Effect.fail(new Error(EXPORT_PATH_INDEX_PREPARING_MESSAGE))
  })
}
