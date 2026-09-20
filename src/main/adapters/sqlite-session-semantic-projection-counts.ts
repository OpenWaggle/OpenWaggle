import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'

export function loadSemanticProjectionStorageCounts(
  sql: SqlClient.SqlClient,
  model: Pick<SessionEmbeddingModel, 'metadata'>,
  recordLimit: number,
) {
  // When the corpus fits, every Session is hot. Keep that decision and the exact
  // counts in one snapshot instead of joining the whole hot tier for every page.
  return sql<{
    readonly session_count: number
    readonly prepared_count: number
    readonly pending_count: number
    readonly hot_prepared_count: number
    readonly hot_pending_count: number
  }>`
    WITH totals AS MATERIALIZED (
      SELECT
        (SELECT COUNT(*) FROM sessions) AS session_count,
        (SELECT COUNT(*) FROM session_discovery_embeddings
          WHERE model_id = ${model.metadata.id}
            AND model_revision = ${model.metadata.revision}
            AND dimensions = ${model.metadata.dimensions}) AS prepared_count,
        (SELECT COUNT(*) FROM session_discovery_embedding_queue) AS pending_count
    )
    SELECT totals.*,
      CASE WHEN session_count <= ${recordLimit} THEN prepared_count ELSE (
        SELECT COUNT(*) FROM session_discovery_embeddings AS embeddings
        JOIN (
          SELECT id FROM sessions ORDER BY updated_at DESC, id DESC LIMIT ${recordLimit}
        ) AS hot_sessions ON hot_sessions.id = embeddings.session_id
        WHERE embeddings.model_id = ${model.metadata.id}
          AND embeddings.model_revision = ${model.metadata.revision}
          AND embeddings.dimensions = ${model.metadata.dimensions}
      ) END AS hot_prepared_count,
      CASE WHEN session_count <= ${recordLimit} THEN pending_count ELSE (
        SELECT COUNT(*) FROM session_discovery_embedding_queue AS queue
        JOIN (
          SELECT id FROM sessions ORDER BY updated_at DESC, id DESC LIMIT ${recordLimit}
        ) AS hot_sessions ON hot_sessions.id = queue.session_id
      ) END AS hot_pending_count
    FROM totals
  `
}

export function loadSemanticProjectionCounts(
  sql: SqlClient.SqlClient,
  model: Pick<SessionEmbeddingModel, 'metadata'>,
  recordLimit: number,
) {
  return sql<{ readonly prepared: number; readonly pending: number; readonly revision: number }>`
    SELECT hot_prepared_count AS prepared, hot_pending_count AS pending,
      MAX(
        COALESCE((SELECT MAX(snapshot_revision) FROM session_discovery_embeddings), 0),
        COALESCE((
          SELECT snapshot_revision FROM session_semantic_discovery_state WHERE singleton = 1
        ), 0)
      ) AS revision
    FROM (${loadSemanticProjectionStorageCounts(sql, model, recordLimit)})
  `
}
