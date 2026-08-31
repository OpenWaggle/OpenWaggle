import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY as POLICY } from '../domain/session-transcript-semantic-storage-policy'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import {
  emptyTranscriptSemanticStorageUsage,
  maintainTranscriptSemanticStorageInTransaction,
  pruneTranscriptSemanticSessionOverflow,
  type TranscriptSemanticStoragePolicy,
  transcriptSemanticStorageUsage,
} from './sqlite-session-transcript-semantic-maintenance'

export {
  maintainTranscriptSemanticStorage,
  type TranscriptSemanticStoragePolicy,
  transcriptSemanticStorageUsage,
} from './sqlite-session-transcript-semantic-maintenance'

interface ScopeCoverageRow {
  readonly session_id: string
  readonly searchable_count: number
  readonly eligible_count: number
  readonly prepared_count: number
  readonly queued_count: number
}

export function refreshTranscriptScopeCoverage(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  sessionIds: readonly string[],
) {
  if (sessionIds.length === 0) return Effect.void
  return Effect.gen(function* () {
    const rows = yield* sql<ScopeCoverageRow>`
      WITH ranked AS (
        SELECT nodes.id AS node_id, nodes.session_id,
          ROW_NUMBER() OVER (
            PARTITION BY nodes.session_id
            ORDER BY nodes.created_order DESC, nodes.id DESC
          ) AS scope_rank,
          scopes.node_limit
        FROM session_nodes AS nodes
        JOIN session_node_search AS search
          ON search.node_id = nodes.id AND trim(search.content) <> ''
        JOIN session_transcript_semantic_scopes AS scopes ON scopes.session_id = nodes.session_id
        WHERE nodes.session_id IN ${sql.in(sessionIds)}
      )
      SELECT ranked.session_id, COUNT(*) AS searchable_count,
        SUM(CASE WHEN scope_rank <= node_limit THEN 1 ELSE 0 END) AS eligible_count,
        SUM(CASE WHEN scope_rank <= node_limit
          AND embeddings.node_id IS NOT NULL
          AND embeddings.model_id = ${model.metadata.id}
          AND embeddings.model_revision = ${model.metadata.revision}
          AND embeddings.dimensions = ${model.metadata.dimensions}
          AND queue.node_id IS NULL THEN 1 ELSE 0 END) AS prepared_count,
        SUM(CASE WHEN scope_rank <= node_limit AND queue.node_id IS NOT NULL
          THEN 1 ELSE 0 END) AS queued_count
      FROM ranked
      LEFT JOIN session_transcript_embeddings AS embeddings ON embeddings.node_id = ranked.node_id
      LEFT JOIN session_transcript_embedding_queue AS queue ON queue.node_id = ranked.node_id
      GROUP BY ranked.session_id
    `
    const coverage = new Map(rows.map((row) => [row.session_id, row]))
    for (const sessionId of sessionIds) {
      const row = coverage.get(sessionId) ?? {
        session_id: sessionId,
        searchable_count: 0,
        eligible_count: 0,
        prepared_count: 0,
        queued_count: 0,
      }
      const perSessionLimited = row.searchable_count > row.eligible_count
      const storageLimited = row.eligible_count > row.prepared_count + row.queued_count
      const reason =
        perSessionLimited && storageLimited
          ? 'per-session-node-limit-and-storage-budget'
          : perSessionLimited
            ? 'per-session-node-limit'
            : storageLimited
              ? 'storage-budget'
              : null
      yield* sql`
        UPDATE session_transcript_semantic_scopes SET
          searchable_node_count = ${row.searchable_count},
          eligible_node_count = ${row.eligible_count},
          coverage_limited = ${reason ? 1 : 0},
          coverage_limit_reason = ${reason}
        WHERE session_id = ${sessionId}
      `
    }
  })
}

export function ensureTranscriptSemanticSessions(input: {
  readonly sql: SqlClient.SqlClient
  readonly model: SessionEmbeddingModel
  readonly sessionIds: readonly string[]
  readonly operationId?: string
  readonly now?: number
  readonly policy?: TranscriptSemanticStoragePolicy
}) {
  if (input.sessionIds.length === 0) return Effect.void
  const now = input.now ?? Date.now()
  const policy = input.policy ?? POLICY
  const vectorBytes = input.model.metadata.dimensions * Float32Array.BYTES_PER_ELEMENT
  return input.sql.withTransaction(
    Effect.gen(function* () {
      yield* input.sql`
        INSERT INTO session_transcript_semantic_scopes (
          session_id, requested_at, last_accessed_at, expires_at, node_limit,
          vector_bytes_per_node, searchable_node_count, eligible_node_count,
          coverage_limited, coverage_limit_reason
        )
        SELECT sessions.id, ${now}, ${now}, ${now + policy.scopeTtlMs},
          ${policy.perSessionNodeLimit}, ${vectorBytes}, ${0}, ${0}, ${0}, NULL
        FROM sessions WHERE sessions.id IN ${input.sql.in(input.sessionIds)}
        ON CONFLICT(session_id) DO UPDATE SET
          requested_at = excluded.requested_at,
          last_accessed_at = excluded.last_accessed_at,
          expires_at = excluded.expires_at,
          node_limit = excluded.node_limit,
          vector_bytes_per_node = excluded.vector_bytes_per_node
      `
      if (input.operationId) {
        yield* input.sql`
          INSERT INTO session_transcript_semantic_leases (
            operation_id, session_id, acquired_at, expires_at
          ) SELECT ${input.operationId}, sessions.id, ${now}, ${now + policy.leaseTtlMs}
          FROM sessions WHERE sessions.id IN ${input.sql.in(input.sessionIds)}
          ON CONFLICT(operation_id, session_id) DO UPDATE SET expires_at = excluded.expires_at
        `
      }
      yield* maintainTranscriptSemanticStorageInTransaction(input.sql, now, policy)
      yield* input.sql`
        DELETE FROM session_transcript_embeddings
        WHERE session_id IN ${input.sql.in(input.sessionIds)}
          AND (
            model_id <> ${input.model.metadata.id}
            OR model_revision <> ${input.model.metadata.revision}
            OR dimensions <> ${input.model.metadata.dimensions}
          )
      `
      yield* pruneTranscriptSemanticSessionOverflow(input.sql)
      const usageRows = yield* transcriptSemanticStorageUsage(input.sql)
      const usage = usageRows[0] ?? emptyTranscriptSemanticStorageUsage
      const availableNodes = Math.max(0, policy.totalNodeLimit - usage.node_count)
      const availableQueue = Math.max(0, policy.queuedNodeLimit - usage.queued_count)
      const availableBytes = Math.max(
        0,
        Math.floor(
          (policy.vectorByteLimit - usage.vector_bytes - usage.reserved_bytes) / vectorBytes,
        ),
      )
      const admissionLimit = Math.min(availableNodes, availableQueue, availableBytes)
      if (admissionLimit > 0) {
        yield* input.sql`
          INSERT INTO session_transcript_embedding_queue (node_id, session_id, queued_at)
          SELECT node_id, session_id, ${now} FROM (
            SELECT nodes.id AS node_id, nodes.session_id,
              ROW_NUMBER() OVER (
                PARTITION BY nodes.session_id
                ORDER BY nodes.created_order DESC, nodes.id DESC
              ) AS scope_rank,
              scopes.node_limit
            FROM session_nodes AS nodes
            JOIN session_node_search AS search
              ON search.node_id = nodes.id AND trim(search.content) <> ''
            JOIN session_transcript_semantic_scopes AS scopes
              ON scopes.session_id = nodes.session_id
            LEFT JOIN session_transcript_embeddings AS embeddings ON embeddings.node_id = nodes.id
            LEFT JOIN session_transcript_embedding_queue AS queue ON queue.node_id = nodes.id
            WHERE nodes.session_id IN ${input.sql.in(input.sessionIds)}
              AND embeddings.node_id IS NULL AND queue.node_id IS NULL
          ) AS candidates
          WHERE scope_rank <= node_limit
          ORDER BY session_id, scope_rank
          LIMIT ${admissionLimit}
          ON CONFLICT(node_id) DO NOTHING
        `
      }
      yield* refreshTranscriptScopeCoverage(input.sql, input.model, input.sessionIds)
    }),
  )
}

export function touchTranscriptSemanticLease(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionIds: readonly string[]
  readonly operationId: string
  readonly now?: number
}) {
  if (input.sessionIds.length === 0) return Effect.void
  const now = input.now ?? Date.now()
  return input.sql.withTransaction(
    Effect.gen(function* () {
      yield* input.sql`
        UPDATE session_transcript_semantic_scopes SET
          last_accessed_at = ${now}, expires_at = ${now + POLICY.scopeTtlMs}
        WHERE session_id IN ${input.sql.in(input.sessionIds)}
      `
      yield* input.sql`
        UPDATE session_transcript_semantic_leases SET expires_at = ${now + POLICY.leaseTtlMs}
        WHERE operation_id = ${input.operationId}
          AND session_id IN ${input.sql.in(input.sessionIds)}
      `
    }),
  )
}

export function acquireTranscriptSemanticLease(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionIds: readonly string[]
  readonly operationId: string
  readonly now?: number
}) {
  if (input.sessionIds.length === 0) return Effect.void
  const now = input.now ?? Date.now()
  return input.sql`
    INSERT INTO session_transcript_semantic_leases (
      operation_id, session_id, acquired_at, expires_at
    ) SELECT ${input.operationId}, scopes.session_id, ${now}, ${now + POLICY.leaseTtlMs}
    FROM session_transcript_semantic_scopes AS scopes
    WHERE scopes.session_id IN ${input.sql.in(input.sessionIds)}
    ON CONFLICT(operation_id, session_id) DO UPDATE SET expires_at = excluded.expires_at
  `.pipe(Effect.asVoid)
}

export function releaseTranscriptSemanticLease(input: {
  readonly sql: SqlClient.SqlClient
  readonly operationId: string
  readonly now?: number
}) {
  const now = input.now ?? Date.now()
  return input.sql.withTransaction(
    Effect.gen(function* () {
      yield* input.sql`
        DELETE FROM session_transcript_semantic_leases
        WHERE operation_id = ${input.operationId}
      `
      yield* maintainTranscriptSemanticStorageInTransaction(input.sql, now, POLICY)
    }),
  )
}
