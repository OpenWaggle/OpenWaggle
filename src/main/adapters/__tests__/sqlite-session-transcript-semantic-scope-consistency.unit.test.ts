import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { enforceTranscriptSemanticScopeLimit } from '../sqlite-session-transcript-semantic-maintenance'
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

describe('SQLite transcript semantic scope consistency', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-transcript-scope-refresh-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('keeps searchable counts and hot ordering exact across edits, moves, and deletion', async () => {
    const runtime = makeRuntime(path.join(root, 'scope-searchable-metadata.sqlite'), model)
    runtimes.push(runtime)
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const before = yield* sql<{ readonly searchable_node_count: number }>`
        SELECT searchable_node_count FROM session_transcript_search_stats
        WHERE session_id = ${'worker'}
      `
        yield* addSearchableNode(sql, { id: 'metadata-edit', sessionId: 'worker', order: 10 })
        yield* sql`UPDATE session_nodes SET content_json = ${'{"text":"  "}'} WHERE id = ${'metadata-edit'}`
        const empty = yield* sql<{ readonly searchable: number }>`
        SELECT searchable FROM session_node_search_rows WHERE node_id = ${'metadata-edit'}
      `
        yield* sql`
        UPDATE session_nodes SET content_json = ${'{"text":"moved"}'},
          session_id = ${'other'}, created_order = ${20}
        WHERE id = ${'metadata-edit'}
      `
        const moved = yield* sql<{
          readonly session_id: string
          readonly searchable: number
          readonly created_order: number
        }>`
        SELECT session_id, searchable, created_order FROM session_node_search_rows
        WHERE node_id = ${'metadata-edit'}
      `
        const movedCount = yield* sql<{ readonly searchable_node_count: number }>`
        SELECT searchable_node_count FROM session_transcript_search_stats WHERE session_id = ${'other'}
      `
        yield* sql`DELETE FROM session_nodes WHERE id = ${'metadata-edit'}`
        const after = yield* sql<{
          readonly session_id: string
          readonly searchable_node_count: number
        }>`
        SELECT session_id, searchable_node_count FROM session_transcript_search_stats
        WHERE session_id IN (${'worker'}, ${'other'}) ORDER BY session_id
      `
        return { before, empty, moved, movedCount, after }
      }),
    )
    expect(result.empty).toEqual([{ searchable: 0 }])
    expect(result.moved).toEqual([{ session_id: 'other', searchable: 1, created_order: 20 }])
    expect(result.movedCount).toEqual([{ searchable_node_count: 1 }])
    expect(result.after).toEqual([
      { session_id: 'other', searchable_node_count: 0 },
      { session_id: 'worker', searchable_node_count: result.before[0]?.searchable_node_count },
    ])
  })

  it('does not leave expired leases blocking LRU scope deletion', async () => {
    const runtime = makeRuntime(path.join(root, 'scope-expired-lru-lease.sqlite'), model)
    runtimes.push(runtime)
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* ensureTranscriptSemanticSessions({
          sql,
          model,
          sessionIds: ['worker', 'other'],
          policy: smallPolicy,
          now: 1,
        })
        yield* sql`
        INSERT INTO session_transcript_semantic_leases (operation_id, session_id, acquired_at, expires_at)
        VALUES (${'expired'}, ${'other'}, ${1}, ${2})
      `
        yield* sql.withTransaction(
          enforceTranscriptSemanticScopeLimit(sql, 3, { ...smallPolicy, scopeLimit: 1 }),
        )
        return yield* sql<{ readonly session_id: string }>`
        SELECT session_id FROM session_transcript_semantic_scopes ORDER BY session_id
      `
      }),
    )
    expect(result).toEqual([{ session_id: 'worker' }])
  })

  it('prunes a reused scope when its per-Session hot tier shrinks', async () => {
    const runtime = makeRuntime(path.join(root, 'scope-shrinking-limit.sqlite'), model)
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
        const ensured = yield* ensureTranscriptSemanticSessions({
          sql,
          model,
          sessionIds: ['worker'],
          policy: { ...smallPolicy, perSessionNodeLimit: 1 },
          now: 2,
        })
        const queued = yield* sql<{ readonly node_id: string }>`
        SELECT node_id FROM session_transcript_embedding_queue WHERE session_id = ${'worker'}
      `
        return { ensured, queued }
      }),
    )
    expect(result.ensured).toEqual({ refreshedSessionCount: 1, reusedSessionCount: 0 })
    expect(result.queued).toEqual([{ node_id: 'node-worker-2' }])
  })

  it('admits only surviving scopes when concurrent requests exceed the LRU limit', async () => {
    const runtime = makeRuntime(path.join(root, 'scope-concurrent-admission.sqlite'), model)
    runtimes.push(runtime)
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* Effect.all(
          ['queen', 'worker', 'other'].map((sessionId) =>
            ensureTranscriptSemanticSessions({
              sql,
              model,
              sessionIds: [sessionId],
              policy: { ...smallPolicy, scopeLimit: 1 },
              now: 1,
            }),
          ),
          { concurrency: 'unbounded' },
        )
        const scopes = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM session_transcript_semantic_scopes
      `
        const orphaned = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM session_transcript_embedding_queue AS queue
        LEFT JOIN session_transcript_semantic_scopes AS scopes ON scopes.session_id = queue.session_id
        WHERE scopes.session_id IS NULL
      `
        return { scopes, orphaned }
      }),
    )
    expect(result.scopes).toEqual([{ count: 1 }])
    expect(result.orphaned).toEqual([{ count: 0 }])
  })
})
