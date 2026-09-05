import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { SessionSemanticDiscoveryStoragePolicy } from '../domain/session-semantic-discovery-storage-policy'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'

export interface SessionSemanticProjectionRow {
  readonly session_id: string
  readonly title: string
  readonly specification_json: string | null
  readonly initial_text: string | null
  readonly preview_text: string | null
  readonly queued_at: number
}

export function semanticProjectionReadinessStatus(
  row: {
    readonly status: 'preparing' | 'ready' | 'failed'
    readonly eligible_count: number
    readonly prepared_count: number
    readonly pending_count: number
  },
  recordLimit: number,
) {
  if (row.status === 'failed') return 'failed' as const
  if (row.pending_count !== 0) return 'preparing' as const
  if (row.eligible_count > recordLimit && row.prepared_count === recordLimit) {
    return 'partial' as const
  }
  return row.prepared_count === row.eligible_count ? ('ready' as const) : ('preparing' as const)
}

export function loadCurrentSemanticProjectionRows(
  sql: SqlClient.SqlClient,
  sessionIds: readonly string[],
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
    WHERE queue.session_id IN ${sql.in(sessionIds)}
  `
}

export function loadSemanticProjectionCounts(
  sql: SqlClient.SqlClient,
  model: {
    readonly metadata: {
      readonly id: string
      readonly revision: string
      readonly dimensions: number
    }
  },
  recordLimit: number,
) {
  return sql<{ readonly prepared: number; readonly pending: number; readonly revision: number }>`
    SELECT
      (SELECT COUNT(*)
        FROM session_discovery_embeddings AS embeddings
        JOIN (
          SELECT id FROM sessions ORDER BY updated_at DESC, id DESC LIMIT ${recordLimit}
        ) AS hot_sessions ON hot_sessions.id = embeddings.session_id
        WHERE embeddings.model_id = ${model.metadata.id}
          AND embeddings.model_revision = ${model.metadata.revision}
          AND embeddings.dimensions = ${model.metadata.dimensions}) AS prepared,
      (SELECT COUNT(*)
        FROM session_discovery_embedding_queue AS queue
        JOIN (
          SELECT id FROM sessions ORDER BY updated_at DESC, id DESC LIMIT ${recordLimit}
        ) AS hot_sessions ON hot_sessions.id = queue.session_id) AS pending,
      MAX(
        COALESCE((SELECT MAX(snapshot_revision) FROM session_discovery_embeddings), 0),
        COALESCE((
          SELECT snapshot_revision FROM session_semantic_discovery_state WHERE singleton = 1
        ), 0)
      ) AS revision
  `
}

export function reconcileSemanticProjectionModel(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  preparationOperationId: string,
  storagePolicy: SessionSemanticDiscoveryStoragePolicy,
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const mismatches = yield* sql<{
        readonly incompatible_embeddings: number
        readonly incompatible_state: number
      }>`
        SELECT
          EXISTS(SELECT 1 FROM session_discovery_embeddings
            WHERE model_id <> ${model.metadata.id}
              OR model_revision <> ${model.metadata.revision}
              OR dimensions <> ${model.metadata.dimensions}) AS incompatible_embeddings,
          EXISTS(SELECT 1 FROM session_semantic_discovery_state
            WHERE singleton = 1 AND (model_id <> ${model.metadata.id}
              OR model_revision <> ${model.metadata.revision}
              OR dimensions <> ${model.metadata.dimensions})) AS incompatible_state
      `
      const mismatch = mismatches[0]
      if (!mismatch?.incompatible_embeddings && !mismatch?.incompatible_state) return
      const now = Date.now()
      yield* sql`
        DELETE FROM session_discovery_embeddings
        WHERE model_id <> ${model.metadata.id}
          OR model_revision <> ${model.metadata.revision}
          OR dimensions <> ${model.metadata.dimensions}
      `
      yield* sql`
        DELETE FROM session_discovery_embedding_queue
        WHERE session_id NOT IN (
          SELECT id FROM sessions
          ORDER BY updated_at DESC, id DESC
          LIMIT ${storagePolicy.recordLimit}
        )
      `
      yield* sql`
        INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
        SELECT hot_sessions.id, ${now}
        FROM (
          SELECT id FROM sessions
          ORDER BY updated_at DESC, id DESC
          LIMIT ${storagePolicy.recordLimit}
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
      const counts = yield* loadSemanticProjectionCounts(sql, model, storagePolicy.recordLimit)
      const count = counts[0] ?? { prepared: 0, pending: 0, revision: 0 }
      yield* sql`
        INSERT INTO session_semantic_discovery_state (
          singleton, status, model_id, model_revision, dimensions,
          snapshot_revision, prepared_count, pending_count,
          preparation_operation_id, updated_at
        ) VALUES (
          ${1}, ${count.pending === 0 ? 'ready' : 'preparing'}, ${model.metadata.id},
          ${model.metadata.revision}, ${model.metadata.dimensions}, ${count.revision},
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
    }),
  )
}

export function reconcileSemanticProjectionStorage(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  preparationOperationId: string,
  storagePolicy: SessionSemanticDiscoveryStoragePolicy,
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const now = Date.now()
      yield* sql`
        DELETE FROM session_discovery_embedding_queue
        WHERE session_id NOT IN (
          SELECT id FROM sessions
          ORDER BY updated_at DESC, id DESC
          LIMIT ${storagePolicy.recordLimit}
        )
      `
      yield* sql`
        INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
        SELECT hot_sessions.id, ${now}
        FROM (
          SELECT id FROM sessions
          ORDER BY updated_at DESC, id DESC
          LIMIT ${storagePolicy.recordLimit}
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
        SELECT COUNT(*) AS count
        FROM session_discovery_embeddings
        WHERE session_id NOT IN (
          SELECT id FROM sessions
          ORDER BY updated_at DESC, id DESC
          LIMIT ${storagePolicy.recordLimit}
        )
      `
      const evictionCount = evictions[0]?.count ?? 0
      const before = yield* loadSemanticProjectionCounts(sql, model, storagePolicy.recordLimit)
      const previousRevision = before[0]?.revision ?? 0
      if (evictionCount > 0) {
        yield* sql`
          DELETE FROM session_discovery_embeddings
          WHERE session_id NOT IN (
            SELECT id FROM sessions
            ORDER BY updated_at DESC, id DESC
            LIMIT ${storagePolicy.recordLimit}
          )
        `
      }
      const counts = yield* loadSemanticProjectionCounts(sql, model, storagePolicy.recordLimit)
      const count = counts[0] ?? { prepared: 0, pending: 0, revision: previousRevision }
      const status = count.pending === 0 ? 'ready' : 'preparing'
      if (evictionCount > 0) {
        const revision = previousRevision + 1
        yield* sql`
          INSERT INTO session_semantic_discovery_state (
            singleton, status, model_id, model_revision, dimensions,
            snapshot_revision, deletion_compaction_revision, prepared_count, pending_count,
            preparation_operation_id, updated_at
          ) VALUES (
            ${1}, ${status}, ${model.metadata.id}, ${model.metadata.revision},
            ${model.metadata.dimensions}, ${revision}, ${revision}, ${count.prepared},
            ${count.pending}, ${preparationOperationId}, ${now}
          )
          ON CONFLICT(singleton) DO UPDATE SET
            status = CASE
              WHEN session_semantic_discovery_state.status = 'failed' THEN 'failed'
              ELSE excluded.status
            END,
            model_id = excluded.model_id, model_revision = excluded.model_revision,
            dimensions = excluded.dimensions, snapshot_revision = excluded.snapshot_revision,
            deletion_compaction_revision = excluded.deletion_compaction_revision,
            prepared_count = excluded.prepared_count, pending_count = excluded.pending_count,
            preparation_operation_id = excluded.preparation_operation_id,
            failure_message = CASE
              WHEN session_semantic_discovery_state.status = 'failed'
                THEN session_semantic_discovery_state.failure_message
              ELSE NULL
            END,
            updated_at = excluded.updated_at
        `
        yield* sql`
          DELETE FROM session_discovery_embedding_deletions
          WHERE snapshot_revision <= ${revision}
        `
      } else {
        yield* sql`
          UPDATE session_semantic_discovery_state
          SET status = CASE
                WHEN status = 'failed' THEN status
                ELSE ${status}
              END,
            prepared_count = ${count.prepared}, pending_count = ${count.pending},
            preparation_operation_id = CASE
              WHEN status = 'failed' THEN preparation_operation_id
              ELSE ${preparationOperationId}
            END,
            updated_at = ${now}
          WHERE singleton = 1
            AND (prepared_count <> ${count.prepared} OR pending_count <> ${count.pending})
        `
      }
    }),
  )
}
