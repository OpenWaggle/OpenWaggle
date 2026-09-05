import { randomUUID } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import type { SemanticDiscoveryReadiness } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import {
  SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY,
  type SessionSemanticDiscoveryStoragePolicy,
} from '../domain/session-semantic-discovery-storage-policy'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import { sessionDiscoveryDocument } from './session-discovery-document'
import { embedPassagesInBatches } from './session-embedding-batches'
import {
  loadSessionSemanticProjectionRows,
  publishSessionSemanticProjectionBatch,
} from './sqlite-session-semantic-projection-batch'
import {
  loadSemanticProjectionCounts,
  reconcileSemanticProjectionModel,
  reconcileSemanticProjectionStorage,
  semanticProjectionReadinessStatus,
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
  readonly eligible_count: number
}
interface SemanticStorageCountRow {
  readonly session_count: number
  readonly prepared_count: number
  readonly pending_count: number
  readonly hot_prepared_count: number
  readonly hot_pending_count: number
}
export class SqliteSessionSemanticProjection {
  readonly #preparationOperationId = randomUUID()
  #modelRevisionReconciled = false
  #storageReconciled = false

  constructor(
    private readonly sql: SqlClient.SqlClient,
    private readonly model: SessionEmbeddingModel,
    private readonly storagePolicy: SessionSemanticDiscoveryStoragePolicy = SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY,
  ) {
    if (!Number.isSafeInteger(storagePolicy.recordLimit) || storagePolicy.recordLimit < 1) {
      throw new Error('Semantic discovery record limit must be a positive safe integer.')
    }
  }
  readiness() {
    return Effect.gen(this, function* () {
      yield* this.#ensureProjectionStorage()
      const rows = yield* this.sql<SemanticStateRow>`
        SELECT status, model_id, model_revision, snapshot_revision,
          (SELECT COUNT(*)
            FROM session_discovery_embeddings AS embeddings
            JOIN (
              SELECT id FROM sessions ORDER BY updated_at DESC, id DESC
              LIMIT ${this.storagePolicy.recordLimit}
            ) AS hot_sessions ON hot_sessions.id = embeddings.session_id
            WHERE embeddings.model_id = ${this.model.metadata.id}
              AND embeddings.model_revision = ${this.model.metadata.revision}
              AND embeddings.dimensions = ${this.model.metadata.dimensions}) AS prepared_count,
          (SELECT COUNT(*)
            FROM session_discovery_embedding_queue AS queue
            JOIN (
              SELECT id FROM sessions ORDER BY updated_at DESC, id DESC
              LIMIT ${this.storagePolicy.recordLimit}
            ) AS hot_sessions ON hot_sessions.id = queue.session_id) AS pending_count,
          preparation_operation_id, failure_message, updated_at,
          (SELECT COUNT(*) FROM sessions) AS eligible_count
        FROM session_semantic_discovery_state WHERE singleton = 1
      `
      const row = rows[0]
      if (!row) {
        const pending = yield* this.sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count
          FROM session_discovery_embedding_queue AS queue
          JOIN (
            SELECT id FROM sessions ORDER BY updated_at DESC, id DESC
            LIMIT ${this.storagePolicy.recordLimit}
          ) AS hot_sessions ON hot_sessions.id = queue.session_id
        `
        return {
          status: 'unavailable',
          pendingCount: pending[0]?.count ?? 0,
          reason: 'Semantic discovery has not been prepared.',
        } satisfies SemanticDiscoveryReadiness
      }
      const status = semanticProjectionReadinessStatus(row, this.storagePolicy.recordLimit)
      const partial = status === 'partial'
      return {
        status,
        modelId: row.model_id,
        modelRevision: row.model_revision,
        snapshotRevision: row.snapshot_revision,
        coverage: row.eligible_count === 0 ? 1 : row.prepared_count / row.eligible_count,
        pendingCount: row.pending_count,
        updatedAt: row.updated_at,
        ...(row.preparation_operation_id
          ? { preparationOperationId: row.preparation_operation_id }
          : {}),
        ...(partial
          ? {
              reason:
                `Semantic discovery covers the ${String(this.storagePolicy.recordLimit)} most ` +
                `recently updated Sessions out of ${String(row.eligible_count)}; older Sessions ` +
                'remain discoverable through lexical search.',
            }
          : row.failure_message
            ? { reason: row.failure_message }
            : {}),
      } satisfies SemanticDiscoveryReadiness
    })
  }
  prepareNextBatch(limit = DEFAULT_PROJECTION_BATCH_SIZE) {
    return Effect.gen(this, function* () {
      yield* this.#prepareProjectionStorage()
      const rows = yield* loadSessionSemanticProjectionRows(
        this.sql,
        limit,
        this.storagePolicy.recordLimit,
      )
      if (rows.length === 0) {
        return { prepared: 0, pending: 0 }
      }
      yield* this.#markPreparing()
      const documents = rows.map(sessionDiscoveryDocument)
      const vectors = yield* Effect.tryPromise({
        try: () => embedPassagesInBatches(this.model, documents, EMBEDDING_INFERENCE_BATCH_SIZE),
        catch: (cause) => new Error('Semantic Session projection failed.', { cause }),
      })
      return yield* publishSessionSemanticProjectionBatch(
        this.sql,
        this.model,
        rows,
        vectors,
        this.#preparationOperationId,
        Date.now(),
        this.storagePolicy.recordLimit,
      )
    })
  }
  recordFailure(message: string) {
    return Effect.gen(this, function* () {
      yield* this.#reconcileProjectionStorage()
      const counts = yield* loadSemanticProjectionCounts(
        this.sql,
        this.model,
        this.storagePolicy.recordLimit,
      )
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
      const counts = yield* loadSemanticProjectionCounts(
        this.sql,
        this.model,
        this.storagePolicy.recordLimit,
      )
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

  #ensureModelRevision() {
    return Effect.gen(this, function* () {
      if (this.#modelRevisionReconciled) return
      yield* reconcileSemanticProjectionModel(
        this.sql,
        this.model,
        this.#preparationOperationId,
        this.storagePolicy,
      )
      this.#modelRevisionReconciled = true
    })
  }

  #ensureProjectionStorage() {
    return Effect.gen(this, function* () {
      yield* this.#ensureModelRevision()
      if (this.#storageReconciled) return
      yield* this.#reconcileProjectionStorage()
    })
  }

  #prepareProjectionStorage() {
    return Effect.gen(this, function* () {
      yield* this.#ensureProjectionStorage()
      const rows = yield* this.sql<SemanticStorageCountRow>`
        SELECT
          (SELECT COUNT(*) FROM sessions) AS session_count,
          (SELECT COUNT(*) FROM session_discovery_embeddings
            WHERE model_id = ${this.model.metadata.id}
              AND model_revision = ${this.model.metadata.revision}
              AND dimensions = ${this.model.metadata.dimensions}) AS prepared_count,
          (SELECT COUNT(*) FROM session_discovery_embedding_queue) AS pending_count,
          (SELECT COUNT(*)
            FROM session_discovery_embeddings AS embeddings
            JOIN (
              SELECT id FROM sessions ORDER BY updated_at DESC, id DESC
              LIMIT ${this.storagePolicy.recordLimit}
            ) AS hot_sessions ON hot_sessions.id = embeddings.session_id
            WHERE embeddings.model_id = ${this.model.metadata.id}
              AND embeddings.model_revision = ${this.model.metadata.revision}
              AND embeddings.dimensions = ${this.model.metadata.dimensions}
          ) AS hot_prepared_count,
          (SELECT COUNT(*)
            FROM session_discovery_embedding_queue AS queue
            JOIN (
              SELECT id FROM sessions ORDER BY updated_at DESC, id DESC
              LIMIT ${this.storagePolicy.recordLimit}
            ) AS hot_sessions ON hot_sessions.id = queue.session_id
          ) AS hot_pending_count
      `
      const row = rows[0]
      if (!row) return
      const queueExceedsLimit = row.pending_count > this.storagePolicy.recordLimit
      const expectedHotRecordCount = Math.min(row.session_count, this.storagePolicy.recordLimit)
      const storageTierIsCurrent =
        row.prepared_count === row.hot_prepared_count &&
        row.pending_count === row.hot_pending_count &&
        row.hot_prepared_count + row.hot_pending_count === expectedHotRecordCount
      if (!queueExceedsLimit && storageTierIsCurrent) return
      yield* this.#reconcileProjectionStorage()
    })
  }

  #reconcileProjectionStorage() {
    return Effect.gen(this, function* () {
      yield* this.#ensureModelRevision()
      yield* reconcileSemanticProjectionStorage(
        this.sql,
        this.model,
        this.#preparationOperationId,
        this.storagePolicy,
      )
      this.#storageReconciled = true
    })
  }
}
