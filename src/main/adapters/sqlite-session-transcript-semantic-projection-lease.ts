import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY as STORAGE_POLICY } from '../domain/session-transcript-semantic-storage-policy'
import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'
import {
  touchTranscriptSemanticLease,
  transcriptSemanticStorageUsage,
} from './sqlite-session-transcript-semantic-storage'

const PROJECTION_LEASE_HEARTBEAT_INTERVAL_MS = Math.floor(STORAGE_POLICY.leaseTtlMs / 4)

export interface TranscriptProjectionClaim {
  readonly node_id: string
  readonly session_id: string
  readonly queued_at: number
}

export function projectionClaimsAreLive(input: {
  readonly sql: SqlClient.SqlClient
  readonly model: SessionEmbeddingModel
  readonly rows: readonly TranscriptProjectionClaim[]
  readonly operationId: string
  readonly now: number
}) {
  const nodeIds = input.rows.map((row) => row.node_id)
  const sessionIds = [...new Set(input.rows.map((row) => row.session_id))]
  return Effect.gen(function* () {
    const leases = yield* input.sql<{ readonly session_id: string }>`
      SELECT leases.session_id
      FROM session_transcript_semantic_leases AS leases
      JOIN session_transcript_semantic_scopes AS scopes ON scopes.session_id = leases.session_id
      WHERE leases.operation_id = ${input.operationId}
        AND leases.session_id IN ${input.sql.in(sessionIds)}
        AND leases.expires_at > ${input.now}
        AND scopes.vector_bytes_per_node = ${input.model.metadata.dimensions * Float32Array.BYTES_PER_ELEMENT}
    `
    if (new Set(leases.map((lease) => lease.session_id)).size !== sessionIds.length) return false
    const claims = yield* input.sql<TranscriptProjectionClaim>`
      SELECT node_id, session_id, queued_at FROM session_transcript_embedding_queue
      WHERE node_id IN ${input.sql.in(nodeIds)}
        AND NOT EXISTS (
          SELECT 1 FROM session_transcript_embeddings AS embeddings
          WHERE embeddings.node_id = session_transcript_embedding_queue.node_id
        )
    `
    const claimByNode = new Map(claims.map((claim) => [claim.node_id, claim]))
    if (
      input.rows.some((row) => {
        const claim = claimByNode.get(row.node_id)
        return claim?.session_id !== row.session_id || claim.queued_at !== row.queued_at
      })
    ) {
      return false
    }
    const usage = (yield* transcriptSemanticStorageUsage(input.sql))[0]
    return (
      usage !== undefined &&
      usage.node_count <= STORAGE_POLICY.totalNodeLimit &&
      usage.vector_bytes + usage.reserved_bytes <= STORAGE_POLICY.vectorByteLimit &&
      usage.queued_count <= STORAGE_POLICY.queuedNodeLimit
    )
  })
}

export function projectionLeaseHeartbeat(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionIds: readonly string[]
  readonly operationId: string
  readonly intervalMs?: number
}): Effect.Effect<never, unknown> {
  return Effect.sleep(input.intervalMs ?? PROJECTION_LEASE_HEARTBEAT_INTERVAL_MS).pipe(
    Effect.zipRight(
      touchTranscriptSemanticLease({
        sql: input.sql,
        sessionIds: input.sessionIds,
        operationId: input.operationId,
      }),
    ),
    Effect.flatMap(() => projectionLeaseHeartbeat(input)),
  )
}
