import type * as SqlClient from '@effect/sql/SqlClient'
import { sessionTranscriptSearchContentSql } from '../services/session-transcript-search-content-sql'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import type { TranscriptSemanticStoragePolicy } from './sqlite-session-transcript-semantic-maintenance'

interface ReusableScopeRow {
  readonly session_id: string
}

const NEWEST_TRANSCRIPT_SEARCH_CONTENT_SQL = sessionTranscriptSearchContentSql('newest_nodes')
const RANKED_TRANSCRIPT_SEARCH_CONTENT_SQL = sessionTranscriptSearchContentSql('nodes')

export function reusableTranscriptSemanticScopes(input: {
  readonly sql: SqlClient.SqlClient
  readonly model: SessionEmbeddingModel
  readonly sessionIds: readonly string[]
  readonly now: number
  readonly policy: TranscriptSemanticStoragePolicy
  readonly vectorBytes: number
}) {
  return input.sql<ReusableScopeRow>`
    SELECT scopes.session_id
    FROM session_transcript_semantic_scopes AS scopes
    WHERE scopes.session_id IN ${input.sql.in(input.sessionIds)}
      AND scopes.expires_at > ${input.now}
      AND scopes.node_limit = ${input.policy.perSessionNodeLimit}
      AND scopes.vector_bytes_per_node = ${input.vectorBytes}
      AND (
        scopes.coverage_limit_reason IS NULL
        OR scopes.coverage_limit_reason = ${'per-session-node-limit'}
      )
      AND NOT EXISTS (
        SELECT 1 FROM session_transcript_embeddings AS embeddings
        WHERE embeddings.session_id = scopes.session_id
          AND (
            embeddings.model_id <> ${input.model.metadata.id}
            OR embeddings.model_revision <> ${input.model.metadata.revision}
            OR embeddings.dimensions <> ${input.model.metadata.dimensions}
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM session_nodes AS eligible_nodes
        LEFT JOIN session_transcript_embeddings AS eligible_embeddings
          ON eligible_embeddings.node_id = eligible_nodes.id
          AND eligible_embeddings.model_id = ${input.model.metadata.id}
          AND eligible_embeddings.model_revision = ${input.model.metadata.revision}
          AND eligible_embeddings.dimensions = ${input.model.metadata.dimensions}
        LEFT JOIN session_transcript_embedding_queue AS eligible_queue
          ON eligible_queue.node_id = eligible_nodes.id
        WHERE eligible_nodes.session_id = scopes.session_id
          AND eligible_nodes.id IN (
            SELECT newest_nodes.id
            FROM session_nodes AS newest_nodes
            WHERE newest_nodes.session_id = scopes.session_id
              AND trim(${input.sql.literal(NEWEST_TRANSCRIPT_SEARCH_CONTENT_SQL)}) <> ''
            ORDER BY newest_nodes.created_order DESC, newest_nodes.id DESC
            LIMIT ${input.policy.perSessionNodeLimit}
          )
          AND eligible_embeddings.node_id IS NULL
          AND eligible_queue.node_id IS NULL
      )
  `
}

export function admitTranscriptSemanticNodes(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionIds: readonly string[]
  readonly now: number
  readonly limit: number
}) {
  return input.sql`
    INSERT INTO session_transcript_embedding_queue (node_id, session_id, queued_at)
    SELECT ranked.node_id, ranked.session_id, ${input.now} FROM (
      SELECT nodes.id AS node_id, nodes.session_id,
        ROW_NUMBER() OVER (
          PARTITION BY nodes.session_id
          ORDER BY nodes.created_order DESC, nodes.id DESC
        ) AS scope_rank,
        scopes.node_limit
      FROM session_transcript_semantic_scopes AS scopes
      CROSS JOIN session_nodes AS nodes ON nodes.session_id = scopes.session_id
      WHERE nodes.session_id IN ${input.sql.in(input.sessionIds)}
        AND trim(${input.sql.literal(RANKED_TRANSCRIPT_SEARCH_CONTENT_SQL)}) <> ''
    ) AS ranked
    LEFT JOIN session_transcript_embeddings AS embeddings
      ON embeddings.node_id = ranked.node_id
    LEFT JOIN session_transcript_embedding_queue AS queue
      ON queue.node_id = ranked.node_id
    WHERE ranked.scope_rank <= ranked.node_limit
      AND embeddings.node_id IS NULL AND queue.node_id IS NULL
    ORDER BY ranked.session_id, ranked.scope_rank
    LIMIT ${input.limit}
    ON CONFLICT(node_id) DO NOTHING
  `
}
