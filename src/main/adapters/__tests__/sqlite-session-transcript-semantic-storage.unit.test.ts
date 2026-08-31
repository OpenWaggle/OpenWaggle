import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SqliteSessionTranscriptSemanticProjection } from '../sqlite-session-transcript-semantic-projection'
import { SqliteSessionTranscriptSemanticSearch } from '../sqlite-session-transcript-semantic-search'
import {
  acquireTranscriptSemanticLease,
  ensureTranscriptSemanticSessions,
  maintainTranscriptSemanticStorage,
  type TranscriptSemanticStoragePolicy,
} from '../sqlite-session-transcript-semantic-storage'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

const model: SessionEmbeddingModel = {
  metadata: { id: 'test/bounded-transcript', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
}

const smallPolicy: TranscriptSemanticStoragePolicy = {
  scopeTtlMs: 60_000,
  leaseTtlMs: 60_000,
  totalNodeLimit: 3,
  vectorByteLimit: 3 * 2 * Float32Array.BYTES_PER_ELEMENT,
  queuedNodeLimit: 2,
  perSessionNodeLimit: 2,
}

function addSearchableNode(
  sql: SqlClient.SqlClient,
  input: { readonly id: string; readonly sessionId: string; readonly order: number },
) {
  return sql`
    INSERT INTO session_nodes (
      id, session_id, kind, role, timestamp_ms, content_json,
      metadata_json, branch_hint_id, created_order
    ) VALUES (
      ${input.id}, ${input.sessionId}, ${'message'}, ${'assistant'}, ${input.order},
      ${JSON.stringify({ text: `semantic node ${input.id}` })}, ${'{}'}, NULL, ${input.order}
    )
  `
}

describe('SQLite transcript semantic storage policy', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-transcript-storage-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('enforces node, vector-byte, queue, and per-Session caps with terminal partial coverage', async () => {
    const runtime = makeRuntime(path.join(root, 'budgets.sqlite'), model)
    runtimes.push(runtime)

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* addSearchableNode(sql, { id: 'node-worker-3', sessionId: 'worker', order: 3 })
        yield* addSearchableNode(sql, { id: 'node-other-1', sessionId: 'other', order: 1 })
        yield* addSearchableNode(sql, { id: 'node-other-2', sessionId: 'other', order: 2 })
        const projection = new SqliteSessionTranscriptSemanticProjection(sql, model)
        for (let cycle = 0; cycle < 3; cycle += 1) {
          yield* ensureTranscriptSemanticSessions({
            sql,
            model,
            sessionIds: ['worker', 'other'],
            policy: smallPolicy,
          })
          yield* projection.prepareNextBatch(10)
        }
        const readiness = yield* projection.readiness(['worker', 'other'])
        const waited = yield* new SqliteSessionTranscriptSemanticSearch(sql, model).waitForFresh(
          { sessionIds: ['worker', 'other'], truncated: false },
          readiness,
          30_000,
        )
        const usage = yield* sql<{
          readonly nodes: number
          readonly bytes: number
          readonly queued: number
        }>`
          SELECT
            (SELECT COUNT(*) FROM (
              SELECT node_id FROM session_transcript_embeddings
              UNION SELECT node_id FROM session_transcript_embedding_queue
            )) AS nodes,
            (SELECT COALESCE(SUM(length(vector)), 0)
              FROM session_transcript_embeddings) AS bytes,
            (SELECT COUNT(*) FROM session_transcript_embedding_queue) AS queued
        `
        return { readiness, waited, usage: usage[0] }
      }),
    )

    expect(result.usage).toEqual({ nodes: 3, bytes: 24, queued: 0 })
    expect(result.readiness).toMatchObject({
      status: 'partial',
      pendingCount: 0,
      coverageLimit: {
        reason: 'per-session-node-limit-and-storage-budget',
        searchableNodeCount: 5,
        eligibleNodeCount: 4,
        preparedNodeCount: 3,
        perSessionNodeLimit: 2,
      },
    })
    expect(result.waited).toEqual(result.readiness)
  })

  it('protects active scopes from LRU eviction and reclaims them after lease expiry', async () => {
    const runtime = makeRuntime(path.join(root, 'leases.sqlite'), model)
    runtimes.push(runtime)

    const remaining = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* addSearchableNode(sql, { id: 'node-other-1', sessionId: 'other', order: 1 })
        const projection = new SqliteSessionTranscriptSemanticProjection(sql, model)
        yield* projection.ensureSessions(['worker', 'other'])
        while ((yield* projection.prepareNextBatch(10)).prepared > 0) {
          // Materialize both scopes before forcing a smaller maintenance budget.
        }
        const now = Date.now()
        yield* sql`
          UPDATE session_transcript_semantic_scopes SET
            last_accessed_at = CASE session_id WHEN ${'worker'} THEN ${1} ELSE ${2} END,
            expires_at = ${now + 60_000}
        `
        yield* acquireTranscriptSemanticLease({
          sql,
          sessionIds: ['worker'],
          operationId: 'active-search',
          now,
        })
        yield* maintainTranscriptSemanticStorage(sql, now, {
          ...smallPolicy,
          totalNodeLimit: 1,
          vectorByteLimit: 8,
          queuedNodeLimit: 10,
        })
        const protectedRows = yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_transcript_semantic_scopes ORDER BY session_id
        `
        yield* sql`
          UPDATE session_transcript_semantic_leases SET expires_at = ${now}
          WHERE operation_id = ${'active-search'}
        `
        yield* maintainTranscriptSemanticStorage(sql, now, {
          ...smallPolicy,
          totalNodeLimit: 1,
          vectorByteLimit: 8,
          queuedNodeLimit: 10,
        })
        const reclaimedRows = yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_transcript_semantic_scopes ORDER BY session_id
        `
        return { protectedRows, reclaimedRows }
      }),
    )

    expect(remaining.protectedRows).toEqual([{ session_id: 'worker' }])
    expect(remaining.reclaimedRows).toEqual([])
  })

  it('holds a durable lease throughout a freshness wait and releases it afterward', async () => {
    const runtime = makeRuntime(path.join(root, 'wait-lease.sqlite'), model)
    runtimes.push(runtime)

    const waiting = executeQuery(runtime, {
      operation: 'search',
      query: 'semantic protocol',
      searchScope: 'full-transcript',
      mode: 'semantic',
      requireFresh: true,
      waitTimeoutMs: 200,
      limit: 1,
    })
    await vi.waitFor(async () => {
      const count = await runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM session_transcript_semantic_leases
          `
          return rows[0]?.count ?? 0
        }),
      )
      expect(count).toBeGreaterThan(0)
    })

    await expect(waiting).resolves.toMatchObject({
      outcome: { operation: 'search', error: { code: 'semantic_not_ready' } },
    })
    const leasesAfter = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_transcript_semantic_leases
        `
      }),
    )
    expect(leasesAfter[0]?.count).toBe(0)
  })
})
