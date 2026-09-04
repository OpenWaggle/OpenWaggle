import { createHash, randomUUID } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import type { SemanticDiscoveryReadiness } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import { sessionDiscoveryDocument } from './session-discovery-document'
import { embedPassagesInBatches } from './session-embedding-batches'
import { encodeFloat32Vector } from './session-flat-vector-index'
import {
  loadCurrentSemanticProjectionRows,
  loadSemanticProjectionCounts,
  type SessionSemanticProjectionRow,
} from './sqlite-session-semantic-projection-source'

export { sessionDiscoveryDocument } from './session-discovery-document'

const DEFAULT_PROJECTION_BATCH_SIZE = 128
const EMBEDDING_INFERENCE_BATCH_SIZE = 32

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
    ORDER BY queue.queued_at, queue.session_id
    LIMIT ${limit}
  `
}

function publishProjectionBatch(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  rows: readonly SessionSemanticProjectionRow[],
  vectors: readonly Float32Array[],
  preparationOperationId: string,
  now: number,
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const publishable: Array<{
        readonly row: SessionSemanticProjectionRow
        readonly vector: Float32Array
        readonly document: string
      }> = []
      const currentRows = yield* loadCurrentSemanticProjectionRows(
        sql,
        rows.map((row) => row.session_id),
      )
      const currentBySessionId = new Map(currentRows.map((row) => [row.session_id, row]))
      for (const [index, row] of rows.entries()) {
        const vector = vectors[index]
        if (!vector || vector.length !== model.metadata.dimensions) {
          return yield* Effect.fail(new Error('Semantic projection vector dimensions mismatch.'))
        }
        const document = sessionDiscoveryDocument(row)
        const current = currentBySessionId.get(row.session_id)
        if (
          current?.queued_at === row.queued_at &&
          sessionDiscoveryDocument(current) === document
        ) {
          publishable.push({ row, vector, document })
        }
      }
      if (publishable.length === 0) {
        const counts = (yield* loadSemanticProjectionCounts(sql))[0] ?? {
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
      for (const { row, vector, document } of publishable) {
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
          DELETE FROM session_discovery_embedding_deletions
          WHERE session_id = ${row.session_id}
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
      return { prepared: publishable.length, pending: count.pending, snapshotRevision: revision }
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
        try: () => embedPassagesInBatches(this.model, documents, EMBEDDING_INFERENCE_BATCH_SIZE),
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
          MAX(
            COALESCE((SELECT MAX(snapshot_revision) FROM session_discovery_embeddings), 0),
            COALESCE((
              SELECT snapshot_revision FROM session_semantic_discovery_state WHERE singleton = 1
            ), 0)
          ) AS revision
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
          MAX(
            COALESCE((SELECT MAX(snapshot_revision) FROM session_discovery_embeddings), 0),
            COALESCE((
              SELECT snapshot_revision FROM session_semantic_discovery_state WHERE singleton = 1
            ), 0)
          ) AS revision
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
