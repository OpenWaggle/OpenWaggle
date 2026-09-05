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
  metadata: { id: 'test/bounded-transcript', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
}

const smallPolicy: TranscriptSemanticStoragePolicy = {
  scopeTtlMs: 60_000,
  leaseTtlMs: 60_000,
  scopeLimit: 3,
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

describe('SQLite transcript semantic prepared scopes', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-transcript-scope-refresh-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('reuses compatible prepared scopes without repeating scope scans', async () => {
    const runtime = makeRuntime(path.join(root, 'scope-reuse.sqlite'), model)
    runtimes.push(runtime)

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const first = yield* ensureTranscriptSemanticSessions({
          sql,
          model,
          sessionIds: ['worker'],
          policy: smallPolicy,
          now: 1,
        })
        const second = yield* ensureTranscriptSemanticSessions({
          sql,
          model,
          sessionIds: ['worker'],
          policy: smallPolicy,
          now: 2,
        })
        return { first, second }
      }),
    )

    expect(result).toEqual({
      first: { refreshedSessionCount: 1, reusedSessionCount: 0 },
      second: { refreshedSessionCount: 0, reusedSessionCount: 1 },
    })
  })

  it('refreshes a capped prepared scope when its newest searchable node is uncovered', async () => {
    const runtime = makeRuntime(path.join(root, 'scope-uncovered.sqlite'), model)
    runtimes.push(runtime)

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projection = new SqliteSessionTranscriptSemanticProjection(sql, model)
        yield* ensureTranscriptSemanticSessions({
          sql,
          model,
          sessionIds: ['worker'],
          policy: smallPolicy,
        })
        while ((yield* projection.prepareNextBatch(10)).prepared > 0) {
          // Prepare both nodes in the reusable two-node scope.
        }
        const initiallyPrepared = yield* sql<{ readonly node_id: string }>`
          SELECT node_id FROM session_transcript_embeddings
          WHERE session_id = ${'worker'}
          ORDER BY node_id
        `
        // Leave the cached eligible count at its cap so the reuse guard must inspect membership.
        yield* sql`DROP TRIGGER session_node_search_insert`
        yield* addSearchableNode(sql, {
          id: 'node-worker-uncovered',
          sessionId: 'worker',
          order: 10,
        })
        const ensured = yield* ensureTranscriptSemanticSessions({
          sql,
          model,
          sessionIds: ['worker'],
          policy: smallPolicy,
        })
        const queued = yield* sql<{ readonly node_id: string }>`
          SELECT node_id FROM session_transcript_embedding_queue
          WHERE session_id = ${'worker'}
          ORDER BY node_id
        `
        const retainedAfterEnsure = yield* sql<{ readonly node_id: string }>`
          SELECT node_id FROM session_transcript_embeddings
          WHERE session_id = ${'worker'}
          ORDER BY node_id
        `
        yield* projection.prepareNextBatch(10)
        const finallyPrepared = yield* sql<{ readonly node_id: string }>`
          SELECT node_id FROM session_transcript_embeddings
          WHERE session_id = ${'worker'}
          ORDER BY node_id
        `
        return { initiallyPrepared, ensured, queued, retainedAfterEnsure, finallyPrepared }
      }),
    )

    expect(result.initiallyPrepared).toEqual([
      { node_id: 'node-worker-1' },
      { node_id: 'node-worker-2' },
    ])
    expect(result.ensured).toEqual({ refreshedSessionCount: 1, reusedSessionCount: 0 })
    expect(result.queued).toEqual([{ node_id: 'node-worker-uncovered' }])
    expect(result.retainedAfterEnsure).toEqual([{ node_id: 'node-worker-2' }])
    expect(result.finallyPrepared).toEqual([
      { node_id: 'node-worker-2' },
      { node_id: 'node-worker-uncovered' },
    ])
  })

  it('refreshes expired scopes and ignores nonexistent requested Sessions', async () => {
    const runtime = makeRuntime(path.join(root, 'scope-expiry.sqlite'), model)
    runtimes.push(runtime)

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* ensureTranscriptSemanticSessions({
          sql,
          model,
          sessionIds: ['worker'],
          policy: smallPolicy,
          now: 1,
        })
        const expired = yield* ensureTranscriptSemanticSessions({
          sql,
          model,
          sessionIds: ['worker'],
          policy: smallPolicy,
          now: smallPolicy.scopeTtlMs + 2,
        })
        const missing = yield* ensureTranscriptSemanticSessions({
          sql,
          model,
          sessionIds: ['missing-session'],
          policy: smallPolicy,
          now: smallPolicy.scopeTtlMs + 3,
        })
        const missingScopes = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_transcript_semantic_scopes
          WHERE session_id = ${'missing-session'}
        `
        return { expired, missing, missingScopeCount: missingScopes[0]?.count ?? -1 }
      }),
    )

    expect(result).toEqual({
      expired: { refreshedSessionCount: 1, reusedSessionCount: 0 },
      missing: { refreshedSessionCount: 0, reusedSessionCount: 0 },
      missingScopeCount: 0,
    })
  })

  it('bounds unleased scope metadata with least-recently-used eviction', async () => {
    const runtime = makeRuntime(path.join(root, 'scope-limit.sqlite'), model)
    runtimes.push(runtime)

    const scopes = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        for (const [index, sessionId] of ['queen', 'worker', 'other'].entries()) {
          yield* ensureTranscriptSemanticSessions({
            sql,
            model,
            sessionIds: [sessionId],
            policy: { ...smallPolicy, scopeLimit: 2 },
            now: index + 1,
          })
        }
        return yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_transcript_semantic_scopes ORDER BY session_id
        `
      }),
    )

    expect(scopes).toEqual([{ session_id: 'other' }, { session_id: 'worker' }])
  })
})
