import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY as POLICY } from '../domain/session-transcript-semantic-storage-policy'

export interface TranscriptSemanticStoragePolicy {
  readonly scopeTtlMs: number
  readonly leaseTtlMs: number
  readonly totalNodeLimit: number
  readonly vectorByteLimit: number
  readonly queuedNodeLimit: number
  readonly perSessionNodeLimit: number
}

export interface TranscriptSemanticStorageUsage {
  readonly node_count: number
  readonly vector_bytes: number
  readonly queued_count: number
  readonly reserved_bytes: number
}

interface ScopeUsageRow extends TranscriptSemanticStorageUsage {
  readonly session_id: string
  readonly last_accessed_at: number
}

export const emptyTranscriptSemanticStorageUsage: TranscriptSemanticStorageUsage = {
  node_count: 0,
  vector_bytes: 0,
  queued_count: 0,
  reserved_bytes: 0,
}

export function transcriptSemanticStorageUsage(sql: SqlClient.SqlClient) {
  return sql<TranscriptSemanticStorageUsage>`
    SELECT
      (SELECT COUNT(*) FROM (
        SELECT node_id FROM session_transcript_embeddings
        UNION SELECT node_id FROM session_transcript_embedding_queue
      )) AS node_count,
      (SELECT COALESCE(SUM(length(vector)), 0)
        FROM session_transcript_embeddings) AS vector_bytes,
      (SELECT COUNT(*) FROM session_transcript_embedding_queue) AS queued_count,
      (SELECT COALESCE(SUM(scopes.vector_bytes_per_node), 0)
        FROM session_transcript_embedding_queue AS queue
        JOIN session_transcript_semantic_scopes AS scopes
          ON scopes.session_id = queue.session_id) AS reserved_bytes
  `
}

function evictScopes(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  if (sessionIds.length === 0) return Effect.void
  return Effect.gen(function* () {
    yield* sql`
      DELETE FROM session_transcript_embedding_queue
      WHERE session_id IN ${sql.in(sessionIds)}
    `
    yield* sql`
      DELETE FROM session_transcript_embeddings
      WHERE session_id IN ${sql.in(sessionIds)}
    `
    yield* sql`
      DELETE FROM session_transcript_semantic_scopes
      WHERE session_id IN ${sql.in(sessionIds)}
        AND NOT EXISTS (
          SELECT 1 FROM session_transcript_semantic_leases AS leases
          WHERE leases.session_id = session_transcript_semantic_scopes.session_id
        )
    `
  })
}

export function pruneTranscriptSemanticSessionOverflow(sql: SqlClient.SqlClient) {
  const rankedNodes = `
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
  `
  return Effect.gen(function* () {
    yield* sql.unsafe(`
      WITH ranked AS (${rankedNodes})
      DELETE FROM session_transcript_embedding_queue
      WHERE node_id IN (SELECT node_id FROM ranked WHERE scope_rank > node_limit)
    `)
    yield* sql.unsafe(`
      WITH ranked AS (${rankedNodes})
      DELETE FROM session_transcript_embeddings
      WHERE node_id IN (SELECT node_id FROM ranked WHERE scope_rank > node_limit)
    `)
  })
}

function overBudget(
  usage: TranscriptSemanticStorageUsage,
  policy: TranscriptSemanticStoragePolicy,
) {
  return (
    usage.node_count > policy.totalNodeLimit ||
    usage.vector_bytes + usage.reserved_bytes > policy.vectorByteLimit ||
    usage.queued_count > policy.queuedNodeLimit
  )
}

function scopeUsageRows(sql: SqlClient.SqlClient, now: number) {
  return sql<ScopeUsageRow>`
    SELECT scopes.session_id, scopes.last_accessed_at,
      (SELECT COUNT(*) FROM (
        SELECT node_id FROM session_transcript_embeddings AS embeddings
          WHERE embeddings.session_id = scopes.session_id
        UNION SELECT node_id FROM session_transcript_embedding_queue AS queue
          WHERE queue.session_id = scopes.session_id
      )) AS node_count,
      (SELECT COALESCE(SUM(length(vector)), 0) FROM session_transcript_embeddings AS embeddings
        WHERE embeddings.session_id = scopes.session_id) AS vector_bytes,
      (SELECT COUNT(*) FROM session_transcript_embedding_queue AS queue
        WHERE queue.session_id = scopes.session_id) AS queued_count,
      (SELECT COUNT(*) * scopes.vector_bytes_per_node
        FROM session_transcript_embedding_queue AS queue
        WHERE queue.session_id = scopes.session_id) AS reserved_bytes
    FROM session_transcript_semantic_scopes AS scopes
    WHERE NOT EXISTS (
      SELECT 1 FROM session_transcript_semantic_leases AS leases
      WHERE leases.session_id = scopes.session_id AND leases.expires_at > ${now}
    )
    ORDER BY scopes.last_accessed_at, scopes.session_id
  `
}

function updateGlobalStateCounts(sql: SqlClient.SqlClient, now: number) {
  return sql`
    UPDATE session_semantic_transcript_state SET
      prepared_count = (SELECT COUNT(*) FROM session_transcript_embeddings),
      pending_count = (SELECT COUNT(*) FROM session_transcript_embedding_queue),
      snapshot_revision = (
        SELECT COALESCE(MAX(snapshot_revision), 0) FROM session_transcript_embeddings
      ),
      updated_at = ${now}
    WHERE singleton = 1
  `
}

export function maintainTranscriptSemanticStorageInTransaction(
  sql: SqlClient.SqlClient,
  now: number,
  policy: TranscriptSemanticStoragePolicy,
) {
  return Effect.gen(function* () {
    yield* sql`DELETE FROM session_transcript_semantic_leases WHERE expires_at <= ${now}`
    const expired = yield* sql<{ readonly session_id: string }>`
      SELECT scopes.session_id FROM session_transcript_semantic_scopes AS scopes
      WHERE scopes.expires_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM session_transcript_semantic_leases AS leases
          WHERE leases.session_id = scopes.session_id AND leases.expires_at > ${now}
        )
    `
    yield* evictScopes(
      sql,
      expired.map((scope) => scope.session_id),
    )
    yield* pruneTranscriptSemanticSessionOverflow(sql)
    const usageRows = yield* transcriptSemanticStorageUsage(sql)
    const usage = { ...(usageRows[0] ?? emptyTranscriptSemanticStorageUsage) }
    if (overBudget(usage, policy)) {
      const candidates = yield* scopeUsageRows(sql, now)
      const evictions: string[] = []
      for (const candidate of candidates) {
        if (!overBudget(usage, policy)) break
        evictions.push(candidate.session_id)
        usage.node_count -= candidate.node_count
        usage.vector_bytes -= candidate.vector_bytes
        usage.queued_count -= candidate.queued_count
        usage.reserved_bytes -= candidate.reserved_bytes
      }
      yield* evictScopes(sql, evictions)
    }
    yield* updateGlobalStateCounts(sql, now)
  })
}

export function maintainTranscriptSemanticStorage(
  sql: SqlClient.SqlClient,
  now = Date.now(),
  policy: TranscriptSemanticStoragePolicy = POLICY,
) {
  return sql.withTransaction(maintainTranscriptSemanticStorageInTransaction(sql, now, policy))
}
