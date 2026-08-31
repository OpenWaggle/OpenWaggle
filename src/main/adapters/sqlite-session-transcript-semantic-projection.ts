import { createHash, randomUUID } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import { encodeFloat32Vector } from './session-flat-vector-index'
import { sessionTranscriptDocument } from './session-transcript-document'
import {
  projectionClaimsAreLive,
  projectionLeaseHeartbeat,
} from './sqlite-session-transcript-semantic-projection-lease'
import { readTranscriptSemanticReadiness } from './sqlite-session-transcript-semantic-readiness'
import {
  acquireTranscriptSemanticLease,
  ensureTranscriptSemanticSessions,
  maintainTranscriptSemanticStorage,
  refreshTranscriptScopeCoverage,
  releaseTranscriptSemanticLease,
} from './sqlite-session-transcript-semantic-storage'

const DEFAULT_TRANSCRIPT_PROJECTION_BATCH_SIZE = 32

interface TranscriptProjectionRow {
  readonly node_id: string
  readonly session_id: string
  readonly kind: string
  readonly role: string | null
  readonly content_json: string
  readonly created_order: number
  readonly queued_at: number
}

function sourceHash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function loadProjectionRows(sql: SqlClient.SqlClient, limit: number) {
  return sql<TranscriptProjectionRow>`
    SELECT queue.node_id, queue.session_id, queue.queued_at,
      nodes.kind, nodes.role, nodes.content_json, nodes.created_order
    FROM session_transcript_embedding_queue AS queue
    JOIN session_nodes AS nodes ON nodes.id = queue.node_id
    ORDER BY queue.queued_at, queue.session_id, queue.node_id
    LIMIT ${limit}
  `
}

function globalCounts(sql: SqlClient.SqlClient, model: SessionEmbeddingModel) {
  return sql<{ readonly prepared: number; readonly pending: number; readonly revision: number }>`
    SELECT
      (SELECT COUNT(*) FROM session_transcript_embeddings
        WHERE model_id = ${model.metadata.id}
          AND model_revision = ${model.metadata.revision}
          AND dimensions = ${model.metadata.dimensions}) AS prepared,
      (SELECT COUNT(*) FROM session_transcript_embedding_queue) AS pending,
      (SELECT COALESCE(MAX(snapshot_revision), 0)
        FROM session_transcript_embeddings) AS revision
  `
}

function publishProjectionBatch(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  rows: readonly TranscriptProjectionRow[],
  vectors: readonly Float32Array[],
  preparationOperationId: string,
  batchOperationId: string,
  now: number,
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const claimsAreLive = yield* projectionClaimsAreLive({
        sql,
        model,
        rows,
        operationId: batchOperationId,
        now,
      })
      if (!claimsAreLive) {
        const counts = (yield* globalCounts(sql, model))[0] ?? {
          prepared: 0,
          pending: 0,
          revision: 0,
        }
        return { prepared: 0, pending: counts.pending, snapshotRevision: counts.revision }
      }
      const revisions = yield* sql<{ readonly revision: number }>`
        SELECT COALESCE(MAX(snapshot_revision), 0) + 1 AS revision
        FROM session_transcript_embeddings
      `
      const revision = revisions[0]?.revision ?? 1
      for (const [index, row] of rows.entries()) {
        const vector = vectors[index]
        if (!vector || vector.length !== model.metadata.dimensions) {
          return yield* Effect.fail(
            new Error('Semantic transcript projection vector dimensions mismatch.'),
          )
        }
        const document = sessionTranscriptDocument({
          kind: row.kind,
          role: row.role,
          contentJson: row.content_json,
        })
        yield* sql`
          INSERT INTO session_transcript_embeddings (
            node_id, session_id, model_id, model_revision, dimensions, source_hash,
            vector, snapshot_revision, created_order, updated_at
          ) SELECT
            ${row.node_id}, ${row.session_id}, ${model.metadata.id},
            ${model.metadata.revision}, ${model.metadata.dimensions}, ${sourceHash(document)},
            ${encodeFloat32Vector(vector)}, ${revision}, ${row.created_order}, ${now}
          FROM session_nodes AS current_node
          JOIN session_node_search AS current_search ON current_search.node_id = current_node.id
          WHERE current_node.id = ${row.node_id}
            AND current_node.kind = ${row.kind}
            AND current_node.role IS ${row.role}
            AND current_node.content_json = ${row.content_json}
            AND trim(current_search.content) <> ''
          ON CONFLICT(node_id) DO UPDATE SET
            session_id = excluded.session_id, model_id = excluded.model_id,
            model_revision = excluded.model_revision, dimensions = excluded.dimensions,
            source_hash = excluded.source_hash, vector = excluded.vector,
            snapshot_revision = excluded.snapshot_revision,
            created_order = excluded.created_order, updated_at = excluded.updated_at
        `
        yield* sql`
          DELETE FROM session_transcript_embedding_queue
          WHERE node_id = ${row.node_id} AND queued_at = ${row.queued_at}
        `
      }
      const counts = yield* globalCounts(sql, model)
      const count = counts[0] ?? { prepared: 0, pending: 0, revision }
      yield* sql`
        INSERT INTO session_semantic_transcript_state (
          singleton, status, model_id, model_revision, dimensions,
          snapshot_revision, prepared_count, pending_count,
          preparation_operation_id, failure_message, updated_at
        ) VALUES (
          ${1}, ${count.pending === 0 ? 'ready' : 'preparing'}, ${model.metadata.id},
          ${model.metadata.revision}, ${model.metadata.dimensions}, ${count.revision},
          ${count.prepared}, ${count.pending}, ${preparationOperationId}, NULL, ${now}
        )
        ON CONFLICT(singleton) DO UPDATE SET
          status = excluded.status, model_id = excluded.model_id,
          model_revision = excluded.model_revision, dimensions = excluded.dimensions,
          snapshot_revision = excluded.snapshot_revision,
          prepared_count = excluded.prepared_count, pending_count = excluded.pending_count,
          preparation_operation_id = COALESCE(
            session_semantic_transcript_state.preparation_operation_id,
            excluded.preparation_operation_id
          ),
          failure_message = NULL, updated_at = excluded.updated_at
      `
      return { prepared: rows.length, pending: count.pending, snapshotRevision: revision }
    }),
  )
}

export class SqliteSessionTranscriptSemanticProjection {
  readonly #preparationOperationId = randomUUID()

  constructor(
    private readonly sql: SqlClient.SqlClient,
    private readonly model: SessionEmbeddingModel,
  ) {}

  ensureSessions(sessionIds: readonly string[], operationId?: string) {
    if (sessionIds.length === 0) return Effect.void
    const now = Date.now()
    return Effect.gen(this, function* () {
      yield* ensureTranscriptSemanticSessions({
        sql: this.sql,
        model: this.model,
        sessionIds,
        ...(operationId ? { operationId } : {}),
        now,
      })
      yield* this.sql`
        INSERT INTO session_semantic_transcript_state (
          singleton, status, model_id, model_revision, dimensions,
          snapshot_revision, prepared_count, pending_count,
          preparation_operation_id, failure_message, updated_at
        ) VALUES (
          ${1}, ${'preparing'}, ${this.model.metadata.id}, ${this.model.metadata.revision},
          ${this.model.metadata.dimensions}, ${0}, ${0}, ${0},
          ${this.#preparationOperationId}, NULL, ${now}
        )
        ON CONFLICT(singleton) DO NOTHING
      `
    })
  }

  readiness(sessionIds: readonly string[]) {
    return readTranscriptSemanticReadiness({
      sql: this.sql,
      model: this.model,
      sessionIds,
      preparationOperationId: this.#preparationOperationId,
    })
  }

  prepareNextBatch(limit = DEFAULT_TRANSCRIPT_PROJECTION_BATCH_SIZE) {
    return Effect.gen(this, function* () {
      yield* maintainTranscriptSemanticStorage(this.sql)
      const batchOperationId = randomUUID()
      const rows = yield* this.sql.withTransaction(
        Effect.gen(this, function* () {
          const selected = yield* loadProjectionRows(this.sql, limit)
          yield* acquireTranscriptSemanticLease({
            sql: this.sql,
            sessionIds: [...new Set(selected.map((row) => row.session_id))],
            operationId: batchOperationId,
          })
          return selected
        }),
      )
      if (rows.length === 0) return { prepared: 0, pending: 0 }
      const sessionIds = [...new Set(rows.map((row) => row.session_id))]
      return yield* Effect.gen(this, function* () {
        yield* this.#markPreparing()
        const vectors = yield* Effect.tryPromise({
          try: () =>
            this.model.embedPassages(
              rows.map((row) =>
                sessionTranscriptDocument({
                  kind: row.kind,
                  role: row.role,
                  contentJson: row.content_json,
                }),
              ),
            ),
          catch: (cause) => new Error('Semantic transcript projection failed.', { cause }),
        }).pipe(
          Effect.raceFirst(
            projectionLeaseHeartbeat({
              sql: this.sql,
              sessionIds,
              operationId: batchOperationId,
            }),
          ),
        )
        const result = yield* publishProjectionBatch(
          this.sql,
          this.model,
          rows,
          vectors,
          this.#preparationOperationId,
          batchOperationId,
          Date.now(),
        )
        yield* refreshTranscriptScopeCoverage(this.sql, this.model, sessionIds)
        return result
      }).pipe(
        Effect.ensuring(
          releaseTranscriptSemanticLease({
            sql: this.sql,
            operationId: batchOperationId,
          }).pipe(Effect.orDie),
        ),
      )
    })
  }

  recordFailure(message: string) {
    return this.#writeState('failed', message)
  }

  #markPreparing() {
    return this.#writeState('preparing')
  }

  #writeState(status: 'preparing' | 'failed', failureMessage?: string) {
    return Effect.gen(this, function* () {
      const counts = yield* globalCounts(this.sql, this.model)
      const count = counts[0] ?? { prepared: 0, pending: 0, revision: 0 }
      yield* this.sql`
        INSERT INTO session_semantic_transcript_state (
          singleton, status, model_id, model_revision, dimensions,
          snapshot_revision, prepared_count, pending_count,
          preparation_operation_id, failure_message, updated_at
        ) VALUES (
          ${1}, ${status}, ${this.model.metadata.id}, ${this.model.metadata.revision},
          ${this.model.metadata.dimensions}, ${count.revision}, ${count.prepared},
          ${count.pending}, ${this.#preparationOperationId}, ${failureMessage ?? null}, ${Date.now()}
        )
        ON CONFLICT(singleton) DO UPDATE SET
          status = excluded.status, model_id = excluded.model_id,
          model_revision = excluded.model_revision, dimensions = excluded.dimensions,
          snapshot_revision = excluded.snapshot_revision,
          prepared_count = excluded.prepared_count, pending_count = excluded.pending_count,
          preparation_operation_id = COALESCE(
            session_semantic_transcript_state.preparation_operation_id,
            excluded.preparation_operation_id
          ),
          failure_message = excluded.failure_message, updated_at = excluded.updated_at
      `
    })
  }
}
