import type * as SqlClient from '@effect/sql/SqlClient'
import type { SqlError } from '@effect/sql/SqlError'
import type { SemanticDiscoveryReadiness } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY as STORAGE_POLICY } from '../domain/session-transcript-semantic-storage-policy'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'

interface TranscriptStateRow {
  readonly status: 'preparing' | 'ready' | 'failed'
  readonly model_id: string
  readonly model_revision: string
  readonly preparation_operation_id: string | null
  readonly failure_message: string | null
  readonly updated_at: number
}

interface TranscriptReadinessCount {
  readonly total: number
  readonly eligible: number
  readonly prepared: number
  readonly queued: number
  readonly revision: number
  readonly node_limit: number
}

function transcriptReadinessStatus(input: {
  readonly queued: number
  readonly limited: boolean
  readonly state: TranscriptStateRow | undefined
  readonly compatibleState: boolean
}): SemanticDiscoveryReadiness['status'] {
  if (input.compatibleState && input.state?.status === 'failed' && input.queued > 0) {
    return 'failed'
  }
  if (input.queued > 0) return 'preparing'
  return input.limited ? 'partial' : 'ready'
}

function emptyReadiness(model: SessionEmbeddingModel): SemanticDiscoveryReadiness {
  return {
    status: 'ready',
    modelId: model.metadata.id,
    modelRevision: model.metadata.revision,
    snapshotRevision: 0,
    coverage: 1,
    pendingCount: 0,
    updatedAt: Date.now(),
  }
}

function readinessCount(
  sql: SqlClient.SqlClient,
  model: SessionEmbeddingModel,
  sessionIds: readonly string[],
) {
  return sql<TranscriptReadinessCount>`
    SELECT
      COALESCE((SELECT SUM(searchable_node_count)
        FROM session_transcript_semantic_scopes
        WHERE session_id IN ${sql.in(sessionIds)}), 0) AS total,
      COALESCE((SELECT SUM(eligible_node_count)
        FROM session_transcript_semantic_scopes
        WHERE session_id IN ${sql.in(sessionIds)}), 0) AS eligible,
      (SELECT COUNT(*) FROM session_transcript_embeddings AS embeddings
        WHERE embeddings.session_id IN ${sql.in(sessionIds)}
          AND embeddings.model_id = ${model.metadata.id}
          AND embeddings.model_revision = ${model.metadata.revision}
          AND embeddings.dimensions = ${model.metadata.dimensions}
          AND NOT EXISTS (
            SELECT 1 FROM session_transcript_embedding_queue AS queue
            WHERE queue.node_id = embeddings.node_id
          )) AS prepared,
      (SELECT COUNT(*) FROM session_transcript_embedding_queue AS queue
        WHERE queue.session_id IN ${sql.in(sessionIds)}) AS queued,
      COALESCE((SELECT MAX(snapshot_revision) FROM session_transcript_embeddings
        WHERE session_id IN ${sql.in(sessionIds)}), 0) AS revision,
      COALESCE((SELECT MAX(node_limit) FROM session_transcript_semantic_scopes
        WHERE session_id IN ${sql.in(sessionIds)}),
        ${STORAGE_POLICY.perSessionNodeLimit}) AS node_limit
  `
}

function coverageLimitReason(count: TranscriptReadinessCount) {
  const perSessionLimited = count.total > count.eligible
  const storageLimited = count.eligible > count.prepared + count.queued
  if (perSessionLimited && storageLimited) {
    return 'per-session-node-limit-and-storage-budget' as const
  }
  return perSessionLimited ? ('per-session-node-limit' as const) : ('storage-budget' as const)
}

export function readTranscriptSemanticReadiness(input: {
  readonly sql: SqlClient.SqlClient
  readonly model: SessionEmbeddingModel
  readonly sessionIds: readonly string[]
  readonly preparationOperationId: string
}): Effect.Effect<SemanticDiscoveryReadiness, SqlError> {
  if (input.sessionIds.length === 0) return Effect.succeed(emptyReadiness(input.model))
  return Effect.gen(function* () {
    const counts = yield* readinessCount(input.sql, input.model, input.sessionIds)
    const stateRows = yield* input.sql<TranscriptStateRow>`
      SELECT status, model_id, model_revision,
        preparation_operation_id, failure_message, updated_at
      FROM session_semantic_transcript_state WHERE singleton = 1
    `
    const count = counts[0] ?? {
      total: 0,
      eligible: 0,
      prepared: 0,
      queued: 0,
      revision: 0,
      node_limit: STORAGE_POLICY.perSessionNodeLimit,
    }
    const state = stateRows[0]
    const limited = count.total > count.eligible || count.eligible > count.prepared + count.queued
    const compatibleState =
      state?.model_id === input.model.metadata.id &&
      state.model_revision === input.model.metadata.revision
    const status = transcriptReadinessStatus({
      queued: count.queued,
      limited,
      state,
      compatibleState,
    })
    return {
      status,
      modelId: input.model.metadata.id,
      modelRevision: input.model.metadata.revision,
      snapshotRevision: count.revision,
      coverage: count.total === 0 ? 1 : count.prepared / count.total,
      pendingCount: count.queued,
      updatedAt: state?.updated_at ?? Date.now(),
      preparationOperationId: state?.preparation_operation_id ?? input.preparationOperationId,
      ...(status === 'failed' && state?.failure_message ? { reason: state.failure_message } : {}),
      ...(status === 'partial'
        ? {
            reason: 'Semantic transcript coverage is bounded by the durable storage policy.',
            coverageLimit: {
              reason: coverageLimitReason(count),
              searchableNodeCount: count.total,
              eligibleNodeCount: count.eligible,
              preparedNodeCount: count.prepared,
              perSessionNodeLimit: count.node_limit,
            },
          }
        : {}),
    } satisfies SemanticDiscoveryReadiness
  })
}
