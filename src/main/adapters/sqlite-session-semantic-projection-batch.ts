import { createHash } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import { sessionDiscoveryDocument } from './session-discovery-document'
import { encodeFloat32Vector } from './session-flat-vector-index'
import {
  loadCurrentSemanticProjectionRows,
  loadSemanticProjectionCounts,
  type SessionSemanticProjectionRow,
} from './sqlite-session-semantic-projection-source'

function sourceHash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

interface PublishableProjectionRow {
  readonly row: SessionSemanticProjectionRow
  readonly vector: Float32Array
  readonly document: string
}

function loadPublishableProjectionRows(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  rows: readonly SessionSemanticProjectionRow[],
  vectors: readonly Float32Array[],
  recordLimit: number,
) {
  return Effect.gen(function* () {
    const publishable: PublishableProjectionRow[] = []
    const currentRows = yield* loadCurrentSemanticProjectionRows(
      sql,
      rows.map((row) => row.session_id),
      recordLimit,
    )
    const currentBySessionId = new Map(currentRows.map((row) => [row.session_id, row]))
    for (const [index, row] of rows.entries()) {
      const vector = vectors[index]
      if (!vector || vector.length !== model.metadata.dimensions) {
        return yield* Effect.fail(new Error('Semantic projection vector dimensions mismatch.'))
      }
      const document = sessionDiscoveryDocument(row)
      const current = currentBySessionId.get(row.session_id)
      if (current?.queued_at === row.queued_at && sessionDiscoveryDocument(current) === document) {
        publishable.push({ row, vector, document })
      }
    }
    return publishable
  })
}

function normalizeSemanticStorageForPublication(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  publishableSessionIds: readonly string[],
  recordLimit: number,
  now: number,
) {
  return Effect.gen(function* () {
    const totals = yield* sql<{
      readonly embedding_count: number
      readonly queue_count: number
    }>`
      SELECT
        (SELECT COUNT(*) FROM session_discovery_embeddings) AS embedding_count,
        (SELECT COUNT(*) FROM session_discovery_embedding_queue) AS queue_count
    `
    const existing =
      publishableSessionIds.length === 0
        ? 0
        : ((yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM session_discovery_embeddings
            WHERE session_id IN ${sql.in(publishableSessionIds)}
          `)[0]?.count ?? 0)
    const total = totals[0] ?? { embedding_count: 0, queue_count: 0 }
    const projectedCount = total.embedding_count + publishableSessionIds.length - existing
    if (projectedCount < recordLimit && total.queue_count <= recordLimit) return 0

    yield* sql`
      DELETE FROM session_discovery_embedding_queue
      WHERE session_id NOT IN (
        SELECT id FROM sessions ORDER BY updated_at DESC, id DESC LIMIT ${recordLimit}
      )
    `
    yield* sql`
      INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
      SELECT hot_sessions.id, ${now}
      FROM (
        SELECT id FROM sessions ORDER BY updated_at DESC, id DESC LIMIT ${recordLimit}
      ) AS hot_sessions
      WHERE NOT EXISTS (
        SELECT 1 FROM session_discovery_embeddings AS embeddings
        WHERE embeddings.session_id = hot_sessions.id
          AND embeddings.model_id = ${model.metadata.id}
          AND embeddings.model_revision = ${model.metadata.revision}
          AND embeddings.dimensions = ${model.metadata.dimensions}
      )
      ON CONFLICT(session_id) DO NOTHING
    `
    const evictions = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM session_discovery_embeddings
      WHERE session_id NOT IN (
        SELECT id FROM sessions ORDER BY updated_at DESC, id DESC LIMIT ${recordLimit}
      )
    `
    const evictionCount = evictions[0]?.count ?? 0
    if (evictionCount > 0) {
      yield* sql`
        DELETE FROM session_discovery_embeddings
        WHERE session_id NOT IN (
          SELECT id FROM sessions ORDER BY updated_at DESC, id DESC LIMIT ${recordLimit}
        )
      `
    }
    return evictionCount
  })
}

function publishProjectionRows(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  rows: readonly PublishableProjectionRow[],
  revision: number,
  now: number,
) {
  return Effect.forEach(rows, ({ row, vector, document }) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO session_discovery_embeddings (
          session_id, model_id, model_revision, dimensions, source_hash,
          vector, snapshot_revision, updated_at
        ) VALUES (
          ${row.session_id}, ${model.metadata.id}, ${model.metadata.revision},
          ${model.metadata.dimensions}, ${sourceHash(document)}, ${encodeFloat32Vector(vector)},
          ${revision}, ${now}
        )
        ON CONFLICT(session_id) DO UPDATE SET
          model_id = excluded.model_id, model_revision = excluded.model_revision,
          dimensions = excluded.dimensions, source_hash = excluded.source_hash,
          vector = excluded.vector, snapshot_revision = excluded.snapshot_revision,
          updated_at = excluded.updated_at
      `
      yield* sql`
        DELETE FROM session_discovery_embedding_deletions WHERE session_id = ${row.session_id}
      `
      yield* sql`
        DELETE FROM session_discovery_embedding_queue
        WHERE session_id = ${row.session_id} AND queued_at = ${row.queued_at}
      `
    }),
  )
}

function publishProjectionState(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  preparationOperationId: string,
  revision: number,
  prepared: number,
  pending: number,
  evictionCount: number,
  now: number,
) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO session_semantic_discovery_state (
        singleton, status, model_id, model_revision, dimensions,
        snapshot_revision, prepared_count, pending_count,
        preparation_operation_id, updated_at
      ) VALUES (
        ${1}, ${pending === 0 ? 'ready' : 'preparing'}, ${model.metadata.id},
        ${model.metadata.revision}, ${model.metadata.dimensions}, ${revision},
        ${prepared}, ${pending}, ${preparationOperationId}, ${now}
      )
      ON CONFLICT(singleton) DO UPDATE SET
        status = excluded.status, model_id = excluded.model_id,
        model_revision = excluded.model_revision, dimensions = excluded.dimensions,
        snapshot_revision = excluded.snapshot_revision,
        prepared_count = excluded.prepared_count, pending_count = excluded.pending_count,
        preparation_operation_id = excluded.preparation_operation_id,
        failure_message = NULL, updated_at = excluded.updated_at
    `
    if (evictionCount > 0) {
      yield* sql`
        UPDATE session_semantic_discovery_state
        SET deletion_compaction_revision = MAX(deletion_compaction_revision, ${revision})
        WHERE singleton = 1
      `
      yield* sql`
        DELETE FROM session_discovery_embedding_deletions
        WHERE snapshot_revision <= ${revision}
      `
    }
  })
}

export function loadSessionSemanticProjectionRows(
  sql: SqlClient.SqlClient,
  limit: number,
  recordLimit: number,
) {
  return sql<SessionSemanticProjectionRow>`
    SELECT queue.session_id, sessions.title, queue.queued_at,
      specifications.specification_json,
      discovery_rows.initial_objective AS initial_text,
      discovery_rows.current_preview AS preview_text
    FROM session_discovery_embedding_queue AS queue
    JOIN sessions ON sessions.id = queue.session_id
    JOIN (
      SELECT id FROM sessions ORDER BY updated_at DESC, id DESC LIMIT ${recordLimit}
    ) AS hot_sessions ON hot_sessions.id = sessions.id
    LEFT JOIN session_discovery_search_rows AS discovery_rows
      ON discovery_rows.session_id = sessions.id
    LEFT JOIN delegation_contracts AS contracts ON contracts.child_session_id = sessions.id
    LEFT JOIN delegation_specifications AS specifications
      ON specifications.delegation_id = contracts.id
      AND specifications.revision = contracts.current_specification_revision
    ORDER BY queue.queued_at, queue.session_id
    LIMIT ${limit}
  `
}

export function publishSessionSemanticProjectionBatch(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  rows: readonly SessionSemanticProjectionRow[],
  vectors: readonly Float32Array[],
  preparationOperationId: string,
  now: number,
  recordLimit: number,
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const publishable = yield* loadPublishableProjectionRows(
        sql,
        model,
        rows,
        vectors,
        recordLimit,
      )
      const evictionCount = yield* normalizeSemanticStorageForPublication(
        sql,
        model,
        publishable.map(({ row }) => row.session_id),
        recordLimit,
        now,
      )
      if (publishable.length === 0 && evictionCount === 0) {
        const counts = (yield* loadSemanticProjectionCounts(sql, model, recordLimit))[0] ?? {
          prepared: 0,
          pending: 0,
          revision: 0,
        }
        return { prepared: 0, pending: counts.pending, snapshotRevision: counts.revision }
      }
      const revisions = yield* sql<{ readonly revision: number }>`
        SELECT MAX(
          COALESCE(MAX(snapshot_revision), 0),
          COALESCE((
            SELECT snapshot_revision FROM session_semantic_discovery_state WHERE singleton = 1
          ), 0)
        ) + 1 AS revision
        FROM session_discovery_embeddings
      `
      const revision = revisions[0]?.revision ?? 1
      yield* publishProjectionRows(sql, model, publishable, revision, now)
      const stored = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM session_discovery_embeddings
      `
      if ((stored[0]?.count ?? 0) > recordLimit) {
        return yield* Effect.fail(new Error('Semantic discovery vector record limit exceeded.'))
      }
      const counts = yield* loadSemanticProjectionCounts(sql, model, recordLimit)
      const count = counts[0] ?? { prepared: 0, pending: 0, revision }
      yield* publishProjectionState(
        sql,
        model,
        preparationOperationId,
        revision,
        count.prepared,
        count.pending,
        evictionCount,
        now,
      )
      return { prepared: publishable.length, pending: count.pending, snapshotRevision: revision }
    }),
  )
}
