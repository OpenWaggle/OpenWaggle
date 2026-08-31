import { createHash, randomUUID } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import type { SemanticDiscoveryReadiness } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import { sessionDiscoveryDocument } from './session-discovery-document'
import { encodeFloat32Vector } from './session-flat-vector-index'

export { sessionDiscoveryDocument } from './session-discovery-document'

const DEFAULT_PROJECTION_BATCH_SIZE = 32

interface ProjectionRow {
  readonly session_id: string
  readonly title: string
  readonly specification_json: string | null
  readonly initial_content_json: string | null
  readonly preview_content_json: string | null
  readonly queued_at: number
}

interface SemanticStateRow {
  readonly status: 'preparing' | 'ready' | 'failed'
  readonly model_id: string
  readonly model_revision: string
  readonly snapshot_revision: number
  readonly prepared_count: number
  readonly pending_count: number
  readonly preparation_operation_id: string | null
  readonly failure_message: string | null
  readonly updated_at: number
}

function sourceHash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function loadProjectionRows(sql: SqlClient.SqlClient, limit: number) {
  return sql<ProjectionRow>`
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
    ORDER BY queue.queued_at, queue.session_id
    LIMIT ${limit}
  `
}

function publishProjectionBatch(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  rows: readonly ProjectionRow[],
  vectors: readonly Float32Array[],
  preparationOperationId: string,
  now: number,
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const revisions = yield* sql<{ readonly revision: number }>`
        SELECT COALESCE(MAX(snapshot_revision), 0) + 1 AS revision
        FROM session_discovery_embeddings
      `
      const revision = revisions[0]?.revision ?? 1
      for (const [index, row] of rows.entries()) {
        const vector = vectors[index]
        if (!vector || vector.length !== model.metadata.dimensions) {
          return yield* Effect.fail(new Error('Semantic projection vector dimensions mismatch.'))
        }
        const document = sessionDiscoveryDocument(row)
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
          DELETE FROM session_discovery_embedding_queue
          WHERE session_id = ${row.session_id} AND queued_at = ${row.queued_at}
        `
      }
      const counts = yield* sql<{ readonly prepared: number; readonly pending: number }>`
        SELECT
          (SELECT COUNT(*) FROM session_discovery_embeddings) AS prepared,
          (SELECT COUNT(*) FROM session_discovery_embedding_queue) AS pending
      `
      const count = counts[0] ?? { prepared: 0, pending: 0 }
      yield* sql`
        INSERT INTO session_semantic_discovery_state (
          singleton, status, model_id, model_revision, dimensions,
          snapshot_revision, prepared_count, pending_count,
          preparation_operation_id, updated_at
        ) VALUES (
          ${1}, ${count.pending === 0 ? 'ready' : 'preparing'}, ${model.metadata.id},
          ${model.metadata.revision}, ${model.metadata.dimensions}, ${revision},
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
      return { prepared: rows.length, pending: count.pending, snapshotRevision: revision }
    }),
  )
}

export class SqliteSessionSemanticProjection {
  readonly #preparationOperationId = randomUUID()

  constructor(
    private readonly sql: SqlClient.SqlClient,
    private readonly model: SessionEmbeddingModel,
  ) {}

  readiness() {
    return Effect.gen(this, function* () {
      const rows = yield* this.sql<SemanticStateRow>`
        SELECT status, model_id, model_revision, snapshot_revision,
          prepared_count, pending_count, preparation_operation_id, failure_message, updated_at
        FROM session_semantic_discovery_state WHERE singleton = 1
      `
      const row = rows[0]
      if (!row) {
        const pending = yield* this.sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_discovery_embedding_queue
        `
        return {
          status: 'unavailable',
          pendingCount: pending[0]?.count ?? 0,
          reason: 'Semantic discovery has not been prepared.',
        } satisfies SemanticDiscoveryReadiness
      }
      return {
        status: row.status,
        modelId: row.model_id,
        modelRevision: row.model_revision,
        snapshotRevision: row.snapshot_revision,
        coverage:
          row.prepared_count + row.pending_count === 0
            ? 1
            : row.prepared_count / (row.prepared_count + row.pending_count),
        pendingCount: row.pending_count,
        updatedAt: row.updated_at,
        ...(row.preparation_operation_id
          ? { preparationOperationId: row.preparation_operation_id }
          : {}),
        ...(row.failure_message ? { reason: row.failure_message } : {}),
      } satisfies SemanticDiscoveryReadiness
    })
  }

  prepareNextBatch(limit = DEFAULT_PROJECTION_BATCH_SIZE) {
    return Effect.gen(this, function* () {
      const rows = yield* loadProjectionRows(this.sql, limit)
      if (rows.length === 0) return { prepared: 0, pending: 0 }
      yield* this.#markPreparing()
      const documents = rows.map(sessionDiscoveryDocument)
      const vectors = yield* Effect.tryPromise({
        try: () => this.model.embedPassages(documents),
        catch: (cause) => new Error('Semantic Session projection failed.', { cause }),
      })
      return yield* publishProjectionBatch(
        this.sql,
        this.model,
        rows,
        vectors,
        this.#preparationOperationId,
        Date.now(),
      )
    })
  }

  recordFailure(message: string) {
    return Effect.gen(this, function* () {
      const counts = yield* this.sql<{
        readonly prepared: number
        readonly pending: number
        readonly revision: number
      }>`
        SELECT
          (SELECT COUNT(*) FROM session_discovery_embeddings) AS prepared,
          (SELECT COUNT(*) FROM session_discovery_embedding_queue) AS pending,
          (SELECT COALESCE(MAX(snapshot_revision), 0)
            FROM session_discovery_embeddings) AS revision
      `
      const count = counts[0] ?? { prepared: 0, pending: 0, revision: 0 }
      yield* this.sql`
        INSERT INTO session_semantic_discovery_state (
          singleton, status, model_id, model_revision, dimensions,
          snapshot_revision, prepared_count, pending_count,
          preparation_operation_id, failure_message, updated_at
        ) VALUES (
          ${1}, ${'failed'}, ${this.model.metadata.id}, ${this.model.metadata.revision},
          ${this.model.metadata.dimensions}, ${count.revision}, ${count.prepared},
          ${count.pending}, ${this.#preparationOperationId}, ${message}, ${Date.now()}
        )
        ON CONFLICT(singleton) DO UPDATE SET status = excluded.status,
          model_id = excluded.model_id, model_revision = excluded.model_revision,
          dimensions = excluded.dimensions, snapshot_revision = excluded.snapshot_revision,
          prepared_count = excluded.prepared_count, pending_count = excluded.pending_count,
          preparation_operation_id = excluded.preparation_operation_id,
          failure_message = excluded.failure_message, updated_at = excluded.updated_at
      `
    })
  }

  #markPreparing() {
    return Effect.gen(this, function* () {
      const counts = yield* this.sql<{
        readonly prepared: number
        readonly pending: number
        readonly revision: number
      }>`
        SELECT
          (SELECT COUNT(*) FROM session_discovery_embeddings) AS prepared,
          (SELECT COUNT(*) FROM session_discovery_embedding_queue) AS pending,
          (SELECT COALESCE(MAX(snapshot_revision), 0)
            FROM session_discovery_embeddings) AS revision
      `
      const count = counts[0] ?? { prepared: 0, pending: 0, revision: 0 }
      yield* this.sql`
        INSERT INTO session_semantic_discovery_state (
          singleton, status, model_id, model_revision, dimensions,
          snapshot_revision, prepared_count, pending_count,
          preparation_operation_id, updated_at
        ) VALUES (
          ${1}, ${'preparing'}, ${this.model.metadata.id}, ${this.model.metadata.revision},
          ${this.model.metadata.dimensions}, ${count.revision}, ${count.prepared},
          ${count.pending}, ${this.#preparationOperationId}, ${Date.now()}
        )
        ON CONFLICT(singleton) DO UPDATE SET status = excluded.status,
          model_id = excluded.model_id, model_revision = excluded.model_revision,
          dimensions = excluded.dimensions, snapshot_revision = excluded.snapshot_revision,
          prepared_count = excluded.prepared_count, pending_count = excluded.pending_count,
          preparation_operation_id = excluded.preparation_operation_id,
          failure_message = NULL, updated_at = excluded.updated_at
      `
    })
  }
}
