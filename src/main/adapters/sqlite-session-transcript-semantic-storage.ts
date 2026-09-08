import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY as POLICY } from '../domain/session-transcript-semantic-storage-policy'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import {
  emptyTranscriptSemanticStorageUsage,
  enforceTranscriptSemanticScopeLimit,
  maintainTranscriptSemanticStorageInTransaction,
  pruneTranscriptSemanticSessionOverflow,
  reclaimExpiredTranscriptSemanticScopesInTransaction,
  type TranscriptSemanticStoragePolicy,
  transcriptSemanticStorageUsage,
} from './sqlite-session-transcript-semantic-maintenance'
import {
  admitTranscriptSemanticNodes,
  reusableTranscriptSemanticScopes,
} from './sqlite-session-transcript-semantic-scope-refresh'

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

const SEMANTIC_SCOPE_WRITE_BATCH_SIZE = 32

function batches<A>(values: readonly A[], size: number) {
  const result: A[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

export function refreshTranscriptScopeCoverage(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  sessionIds: readonly string[],
) {
  if (sessionIds.length === 0) return Effect.void
  return Effect.gen(function* () {
    for (const sessionId of sessionIds) {
      const rows = yield* sql<ScopeCoverageRow>`
        SELECT scopes.session_id,
          COALESCE(stats.searchable_node_count, 0) AS searchable_count,
          MIN(COALESCE(stats.searchable_node_count, 0), scopes.node_limit) AS eligible_count,
          (SELECT COUNT(*) FROM session_transcript_embeddings AS embeddings
            WHERE embeddings.session_id = scopes.session_id
              AND embeddings.model_id = ${model.metadata.id}
              AND embeddings.model_revision = ${model.metadata.revision}
              AND embeddings.dimensions = ${model.metadata.dimensions}) AS prepared_count,
          (SELECT COUNT(*) FROM session_transcript_embedding_queue AS queue
            WHERE queue.session_id = scopes.session_id) AS queued_count
        FROM session_transcript_semantic_scopes AS scopes
        LEFT JOIN session_transcript_search_stats AS stats
          ON stats.session_id = scopes.session_id
        WHERE scopes.session_id = ${sessionId}
        LIMIT 1
      `
      const row = rows[0] ?? {
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
          prepared_source_revision = source_revision,
          searchable_node_count = ${row.searchable_count},
          eligible_node_count = ${row.eligible_count},
          coverage_limited = ${reason ? 1 : 0},
          coverage_limit_reason = ${reason}
        WHERE session_id = ${sessionId}
      `
      yield* Effect.yieldNow()
    }
  })
}

function prepareTranscriptSemanticScopes(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionIds: readonly string[]
  readonly policy: TranscriptSemanticStoragePolicy
  readonly now: number
  readonly vectorBytes: number
  readonly operationId?: string
}) {
  const { sessionIds, policy, now, vectorBytes } = input
  return Effect.gen(function* () {
    yield* input.sql.withTransaction(
      reclaimExpiredTranscriptSemanticScopesInTransaction(input.sql, now),
    )
    for (const sessionBatch of batches(sessionIds, SEMANTIC_SCOPE_WRITE_BATCH_SIZE)) {
      yield* input.sql.withTransaction(
        Effect.gen(function* () {
          yield* input.sql`
            INSERT INTO session_transcript_semantic_scopes (
              session_id, requested_at, last_accessed_at, expires_at, node_limit,
              vector_bytes_per_node, searchable_node_count, eligible_node_count,
              coverage_limited, coverage_limit_reason
            )
            SELECT sessions.id, ${now}, ${now}, ${now + policy.scopeTtlMs},
              ${policy.perSessionNodeLimit}, ${vectorBytes}, ${0}, ${0}, ${0}, NULL
            FROM sessions WHERE sessions.id IN ${input.sql.in(sessionBatch)}
            ON CONFLICT(session_id) DO UPDATE SET
              requested_at = excluded.requested_at,
              last_accessed_at = excluded.last_accessed_at,
              expires_at = excluded.expires_at,
              prepared_source_revision = CASE
                WHEN node_limit <> excluded.node_limit
                  OR vector_bytes_per_node <> excluded.vector_bytes_per_node THEN -1
                ELSE prepared_source_revision END,
              node_limit = excluded.node_limit,
              vector_bytes_per_node = excluded.vector_bytes_per_node
          `
          if (input.operationId) {
            yield* input.sql`
              INSERT INTO session_transcript_semantic_leases (
                operation_id, session_id, acquired_at, expires_at
              ) SELECT ${input.operationId}, sessions.id, ${now}, ${now + policy.leaseTtlMs}
              FROM sessions WHERE sessions.id IN ${input.sql.in(sessionBatch)}
              ON CONFLICT(operation_id, session_id) DO UPDATE SET expires_at = excluded.expires_at
            `
          }
        }),
      )
      yield* Effect.yieldNow()
    }
    yield* input.sql.withTransaction(enforceTranscriptSemanticScopeLimit(input.sql, now, policy))
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
  const requestedSessionIds = [...new Set(input.sessionIds)]
  const now = input.now ?? Date.now()
  const policy = input.policy ?? POLICY
  const vectorBytes = input.model.metadata.dimensions * Float32Array.BYTES_PER_ELEMENT
  return Effect.gen(function* () {
    const existingSessions = yield* input.sql<{ readonly session_id: string }>`
      SELECT id AS session_id FROM sessions
      WHERE id IN ${input.sql.in(requestedSessionIds)}
    `
    const existingSessionIds = new Set(existingSessions.map((row) => row.session_id))
    const sessionIds = requestedSessionIds.filter((sessionId) => existingSessionIds.has(sessionId))
    if (sessionIds.length === 0) {
      return { refreshedSessionCount: 0, reusedSessionCount: 0 }
    }
    yield* prepareTranscriptSemanticScopes({ ...input, sessionIds, policy, now, vectorBytes })
    let refreshedSessionCount = 0
    let reusedSessionCount = 0
    for (const sessionId of sessionIds) {
      const result = yield* input.sql.withTransaction(
        Effect.gen(function* () {
          // Reuse and refresh share a transaction. A concurrent ensure may evict/recreate the
          // scope after admission, or append a node while a previous Session was refreshed.
          const scopes = yield* input.sql<{ readonly session_id: string }>`
            SELECT session_id FROM session_transcript_semantic_scopes
            WHERE session_id = ${sessionId}
              AND node_limit = ${policy.perSessionNodeLimit}
              AND vector_bytes_per_node = ${vectorBytes}
          `
          if (scopes.length === 0) return 'evicted' as const
          const reusableRows = yield* reusableTranscriptSemanticScopes({
            sql: input.sql,
            model: input.model,
            sessionIds: [sessionId],
            now,
            policy,
            vectorBytes,
          })
          if (reusableRows.length > 0) return 'reused' as const
          yield* input.sql`
            DELETE FROM session_transcript_embeddings
            WHERE session_id = ${sessionId}
              AND (
                model_id <> ${input.model.metadata.id}
                OR model_revision <> ${input.model.metadata.revision}
                OR dimensions <> ${input.model.metadata.dimensions}
              )
          `
          yield* pruneTranscriptSemanticSessionOverflow(input.sql, [sessionId])
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
            yield* admitTranscriptSemanticNodes({
              sql: input.sql,
              sessionId,
              nodeLimit: policy.perSessionNodeLimit,
              now,
              limit: admissionLimit,
            })
          }
          yield* refreshTranscriptScopeCoverage(input.sql, input.model, [sessionId])
          return 'refreshed' as const
        }),
      )
      if (result === 'refreshed') refreshedSessionCount += 1
      if (result === 'reused') reusedSessionCount += 1
      yield* Effect.yieldNow()
    }
    return { refreshedSessionCount, reusedSessionCount }
  })
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
  readonly maintainStorage?: boolean
}) {
  const now = input.now ?? Date.now()
  return input.sql.withTransaction(
    Effect.gen(function* () {
      yield* input.sql`
        DELETE FROM session_transcript_semantic_leases
        WHERE operation_id = ${input.operationId}
      `
      if (input.maintainStorage !== false) {
        yield* maintainTranscriptSemanticStorageInTransaction(input.sql, now, POLICY)
      } else {
        yield* enforceTranscriptSemanticScopeLimit(input.sql, now, POLICY)
      }
    }),
  )
}
