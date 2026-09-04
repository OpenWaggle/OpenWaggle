import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'

export interface SessionSemanticProjectionRow {
  readonly session_id: string
  readonly title: string
  readonly specification_json: string | null
  readonly initial_text: string | null
  readonly preview_text: string | null
  readonly queued_at: number
}

export function loadCurrentSemanticProjectionRows(
  sql: SqlClient.SqlClient,
  sessionIds: readonly string[],
) {
  return sql<SessionSemanticProjectionRow>`
    SELECT queue.session_id, sessions.title, queue.queued_at,
      specifications.specification_json,
      discovery_rows.initial_objective AS initial_text,
      discovery_rows.current_preview AS preview_text
    FROM session_discovery_embedding_queue AS queue
    JOIN sessions ON sessions.id = queue.session_id
    LEFT JOIN session_discovery_search_rows AS discovery_rows
      ON discovery_rows.session_id = sessions.id
    LEFT JOIN delegation_contracts AS contracts ON contracts.child_session_id = sessions.id
    LEFT JOIN delegation_specifications AS specifications
      ON specifications.delegation_id = contracts.id
      AND specifications.revision = contracts.current_specification_revision
    WHERE queue.session_id IN ${sql.in(sessionIds)}
  `
}

export function loadSemanticProjectionCounts(
  sql: SqlClient.SqlClient,
  model: {
    readonly metadata: {
      readonly id: string
      readonly revision: string
      readonly dimensions: number
    }
  },
) {
  return sql<{ readonly prepared: number; readonly pending: number; readonly revision: number }>`
    SELECT
      (SELECT COUNT(*) FROM session_discovery_embeddings
        WHERE model_id = ${model.metadata.id}
          AND model_revision = ${model.metadata.revision}
          AND dimensions = ${model.metadata.dimensions}) AS prepared,
      (SELECT COUNT(*) FROM session_discovery_embedding_queue) AS pending,
      MAX(
        COALESCE((SELECT MAX(snapshot_revision) FROM session_discovery_embeddings), 0),
        COALESCE((
          SELECT snapshot_revision FROM session_semantic_discovery_state WHERE singleton = 1
        ), 0)
      ) AS revision
  `
}

export function reconcileSemanticProjectionModel(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  preparationOperationId: string,
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const mismatches = yield* sql<{
        readonly incompatible_embeddings: number
        readonly incompatible_state: number
      }>`
        SELECT
          EXISTS(SELECT 1 FROM session_discovery_embeddings
            WHERE model_id <> ${model.metadata.id}
              OR model_revision <> ${model.metadata.revision}
              OR dimensions <> ${model.metadata.dimensions}) AS incompatible_embeddings,
          EXISTS(SELECT 1 FROM session_semantic_discovery_state
            WHERE singleton = 1 AND (model_id <> ${model.metadata.id}
              OR model_revision <> ${model.metadata.revision}
              OR dimensions <> ${model.metadata.dimensions})) AS incompatible_state
      `
      const mismatch = mismatches[0]
      if (!mismatch?.incompatible_embeddings && !mismatch?.incompatible_state) return
      const now = Date.now()
      yield* sql`
        INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
        SELECT sessions.id, ${now} FROM sessions
        WHERE NOT EXISTS (
          SELECT 1 FROM session_discovery_embeddings AS embeddings
          WHERE embeddings.session_id = sessions.id
            AND embeddings.model_id = ${model.metadata.id}
            AND embeddings.model_revision = ${model.metadata.revision}
            AND embeddings.dimensions = ${model.metadata.dimensions}
        )
        ON CONFLICT(session_id) DO NOTHING
      `
      yield* sql`
        DELETE FROM session_discovery_embeddings
        WHERE model_id <> ${model.metadata.id}
          OR model_revision <> ${model.metadata.revision}
          OR dimensions <> ${model.metadata.dimensions}
      `
      const counts = yield* loadSemanticProjectionCounts(sql, model)
      const count = counts[0] ?? { prepared: 0, pending: 0, revision: 0 }
      yield* sql`
        INSERT INTO session_semantic_discovery_state (
          singleton, status, model_id, model_revision, dimensions,
          snapshot_revision, prepared_count, pending_count,
          preparation_operation_id, updated_at
        ) VALUES (
          ${1}, ${count.pending === 0 ? 'ready' : 'preparing'}, ${model.metadata.id},
          ${model.metadata.revision}, ${model.metadata.dimensions}, ${count.revision},
          ${count.prepared}, ${count.pending}, ${preparationOperationId}, ${now}
        )
        ON CONFLICT(singleton) DO UPDATE SET
          status = excluded.status, model_id = excluded.model_id,
          model_revision = excluded.model_revision, dimensions = excluded.dimensions,
          snapshot_revision = excluded.snapshot_revision,
          prepared_count = excluded.prepared_count, pending_count = excluded.pending_count,
          preparation_operation_id = excluded.preparation_operation_id,
          failure_message = NULL, updated_at = excluded.updated_at
      `
    }),
  )
}
