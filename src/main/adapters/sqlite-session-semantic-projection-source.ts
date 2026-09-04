import type * as SqlClient from '@effect/sql/SqlClient'

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

export function loadSemanticProjectionCounts(sql: SqlClient.SqlClient) {
  return sql<{ readonly prepared: number; readonly pending: number; readonly revision: number }>`
    SELECT
      (SELECT COUNT(*) FROM session_discovery_embeddings) AS prepared,
      (SELECT COUNT(*) FROM session_discovery_embedding_queue) AS pending,
      MAX(
        COALESCE((SELECT MAX(snapshot_revision) FROM session_discovery_embeddings), 0),
        COALESCE((
          SELECT snapshot_revision FROM session_semantic_discovery_state WHERE singleton = 1
        ), 0)
      ) AS revision
  `
}
