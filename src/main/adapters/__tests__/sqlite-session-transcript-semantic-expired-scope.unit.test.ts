import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SqliteSessionTranscriptSemanticProjection } from '../sqlite-session-transcript-semantic-projection'
import {
  ensureTranscriptSemanticSessions,
  type TranscriptSemanticStoragePolicy,
} from '../sqlite-session-transcript-semantic-storage'
import { makeSessionQueryRuntime as makeRuntime } from './sqlite-session-query-test-layer'

const model: SessionEmbeddingModel = {
  metadata: { id: 'test/expired-scope', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
}

const policy: TranscriptSemanticStoragePolicy = {
  scopeTtlMs: 60_000,
  leaseTtlMs: 120_000,
  scopeLimit: 3,
  totalNodeLimit: 1,
  vectorByteLimit: 2 * Float32Array.BYTES_PER_ELEMENT,
  queuedNodeLimit: 1,
  perSessionNodeLimit: 1,
}

describe('SQLite transcript semantic expired-scope reclamation', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-expired-scope-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('protects a live lease, then reclaims its expired scope before admitting another', async () => {
    const runtime = makeRuntime(path.join(root, 'reclaim.sqlite'), model)
    runtimes.push(runtime)
    const startedAt = Date.now()

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, created_order
          ) VALUES (
            ${'node-other-semantic'}, ${'other'}, ${'message'}, ${'assistant'}, ${1},
            ${'{"text":"expired semantic scope"}'}, ${'{}'}, NULL, ${1}
          )
        `
        yield* ensureTranscriptSemanticSessions({
          sql,
          model,
          sessionIds: ['other'],
          operationId: 'protected-expired-scope',
          policy,
          now: startedAt,
        })
        const projection = new SqliteSessionTranscriptSemanticProjection(sql, model)
        yield* projection.prepareNextBatch(10)

        const protectedEnsure = yield* ensureTranscriptSemanticSessions({
          sql,
          model,
          sessionIds: ['worker'],
          policy,
          now: startedAt + policy.scopeTtlMs + 1,
        })
        const protectedState = yield* sql<{
          readonly other_embeddings: number
          readonly other_scopes: number
          readonly worker_queue: number
        }>`
          SELECT
            (SELECT COUNT(*) FROM session_transcript_embeddings
              WHERE session_id = ${'other'}) AS other_embeddings,
            (SELECT COUNT(*) FROM session_transcript_semantic_scopes
              WHERE session_id = ${'other'}) AS other_scopes,
            (SELECT COUNT(*) FROM session_transcript_embedding_queue
              WHERE session_id = ${'worker'}) AS worker_queue
        `

        const reclaimedEnsure = yield* ensureTranscriptSemanticSessions({
          sql,
          model,
          sessionIds: ['worker'],
          policy,
          now: startedAt + policy.leaseTtlMs + 1,
        })
        const reclaimedState = yield* sql<{
          readonly node_id: string
          readonly other_embeddings: number
          readonly other_scopes: number
        }>`
          SELECT queue.node_id,
            (SELECT COUNT(*) FROM session_transcript_embeddings
              WHERE session_id = ${'other'}) AS other_embeddings,
            (SELECT COUNT(*) FROM session_transcript_semantic_scopes
              WHERE session_id = ${'other'}) AS other_scopes
          FROM session_transcript_embedding_queue AS queue
          WHERE queue.session_id = ${'worker'}
        `
        return {
          protectedEnsure,
          protectedState: protectedState[0],
          reclaimedEnsure,
          reclaimedState,
        }
      }),
    )

    expect(result.protectedEnsure).toEqual({ refreshedSessionCount: 1, reusedSessionCount: 0 })
    expect(result.protectedState).toEqual({
      other_embeddings: 1,
      other_scopes: 1,
      worker_queue: 0,
    })
    expect(result.reclaimedEnsure).toEqual({ refreshedSessionCount: 1, reusedSessionCount: 0 })
    expect(result.reclaimedState).toEqual([
      { node_id: 'node-worker-2', other_embeddings: 0, other_scopes: 0 },
    ])
  })
})
