import type * as SqlClient from '@effect/sql/SqlClient'

export interface SessionSemanticProjectionRow {
  readonly session_id: string
  readonly title: string
  readonly specification_json: string | null
  readonly initial_content_json: string | null
  readonly preview_content_json: string | null
  readonly queued_at: number
}

export function loadCurrentSemanticProjectionRow(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<SessionSemanticProjectionRow>`
    SELECT queue.session_id, sessions.title, queue.queued_at,
      specifications.specification_json,
      (SELECT initial.content_json FROM session_nodes AS initial
        WHERE initial.session_id = sessions.id AND initial.role = 'user'
        ORDER BY initial.created_order, initial.id LIMIT 1) AS initial_content_json,
      (SELECT preview.content_json FROM session_nodes AS preview
        WHERE preview.session_id = sessions.id AND preview.role IN ('user', 'assistant')
        ORDER BY preview.created_order DESC, preview.id DESC LIMIT 1) AS preview_content_json
    FROM session_discovery_embedding_queue AS queue
    JOIN sessions ON sessions.id = queue.session_id
    LEFT JOIN delegation_contracts AS contracts ON contracts.child_session_id = sessions.id
    LEFT JOIN delegation_specifications AS specifications
      ON specifications.delegation_id = contracts.id
      AND specifications.revision = contracts.current_specification_revision
    WHERE queue.session_id = ${sessionId}
    LIMIT 1
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
