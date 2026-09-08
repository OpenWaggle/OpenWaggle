import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import type { TranscriptSemanticStoragePolicy } from './sqlite-session-transcript-semantic-maintenance'

interface ReusableScopeRow {
  readonly session_id: string
}

interface MissingHotNodeRow {
  readonly missing: number
}

function scopeHasCompleteHotTier(input: {
  readonly sql: SqlClient.SqlClient
  readonly model: SessionEmbeddingModel
  readonly sessionId: string
  readonly nodeLimit: number
}) {
  return Effect.map(
    input.sql<MissingHotNodeRow>`
      WITH hot_nodes AS (
        SELECT node_id
        FROM session_node_search_rows
        WHERE session_id = ${input.sessionId} AND searchable = ${1}
        ORDER BY created_order DESC, node_id DESC
        LIMIT ${input.nodeLimit}
      )
      SELECT 1 AS missing
      FROM hot_nodes
      LEFT JOIN session_transcript_embeddings AS embeddings
        ON embeddings.node_id = hot_nodes.node_id
      LEFT JOIN session_transcript_embedding_queue AS queue
        ON queue.node_id = hot_nodes.node_id
      WHERE (
          embeddings.node_id IS NULL AND queue.node_id IS NULL
        ) OR (
          embeddings.node_id IS NOT NULL AND (
            embeddings.model_id <> ${input.model.metadata.id}
            OR embeddings.model_revision <> ${input.model.metadata.revision}
            OR embeddings.dimensions <> ${input.model.metadata.dimensions}
          )
        )
      LIMIT 1
    `,
    (rows) => rows.length === 0,
  )
}

export function reusableTranscriptSemanticScopes(input: {
  readonly sql: SqlClient.SqlClient
  readonly model: SessionEmbeddingModel
  readonly sessionIds: readonly string[]
  readonly now: number
  readonly policy: TranscriptSemanticStoragePolicy
  readonly vectorBytes: number
}) {
  return Effect.gen(function* () {
    const candidates = yield* input.sql<ReusableScopeRow>`
      SELECT scopes.session_id
      FROM session_transcript_semantic_scopes AS scopes
      WHERE scopes.session_id IN ${input.sql.in(input.sessionIds)}
        AND scopes.expires_at > ${input.now}
        AND scopes.node_limit = ${input.policy.perSessionNodeLimit}
        AND scopes.vector_bytes_per_node = ${input.vectorBytes}
        AND scopes.prepared_source_revision = scopes.source_revision
        AND (
          scopes.coverage_limit_reason IS NULL
          OR scopes.coverage_limit_reason = ${'per-session-node-limit'}
        )
      ORDER BY scopes.session_id
    `
    const reusable: ReusableScopeRow[] = []
    for (const candidate of candidates) {
      const complete = yield* scopeHasCompleteHotTier({
        sql: input.sql,
        model: input.model,
        sessionId: candidate.session_id,
        nodeLimit: input.policy.perSessionNodeLimit,
      })
      if (complete) reusable.push(candidate)
      yield* Effect.yieldNow()
    }
    return reusable
  })
}

export function admitTranscriptSemanticNodes(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionId: string
  readonly nodeLimit: number
  readonly now: number
  readonly limit: number
}) {
  return input.sql`
    INSERT INTO session_transcript_embedding_queue (node_id, session_id, queued_at)
    SELECT hot.node_id, ${input.sessionId}, ${input.now}
    FROM (
      SELECT node_id, created_order
      FROM session_node_search_rows
      WHERE session_id = ${input.sessionId} AND searchable = ${1}
      ORDER BY created_order DESC, node_id DESC
      LIMIT ${input.nodeLimit}
    ) AS hot
    LEFT JOIN session_transcript_embeddings AS embeddings
      ON embeddings.node_id = hot.node_id
    LEFT JOIN session_transcript_embedding_queue AS queue
      ON queue.node_id = hot.node_id
    WHERE embeddings.node_id IS NULL AND queue.node_id IS NULL
      AND EXISTS (
        SELECT 1 FROM session_transcript_semantic_scopes AS scopes
        WHERE scopes.session_id = ${input.sessionId}
          AND scopes.node_limit = ${input.nodeLimit}
      )
    ORDER BY hot.created_order DESC, hot.node_id DESC
    LIMIT ${input.limit}
    ON CONFLICT(node_id) DO NOTHING
  `
}
