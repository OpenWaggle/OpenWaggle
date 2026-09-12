import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { encodeFloat32Vector } from '../session-flat-vector-index'
import { SqliteSessionTranscriptSemanticProjection } from '../sqlite-session-transcript-semantic-projection'
import { SqliteSessionTranscriptSemanticSearch } from '../sqlite-session-transcript-semantic-search'
import { makeSessionQueryRuntime as makeRuntime } from './sqlite-session-query-test-layer'

const TRANSCRIPT_MARKER = 'neural handshake verifier'
const TRANSCRIPT_QUERY = 'private verification protocol'

const model: SessionEmbeddingModel = {
  metadata: { id: 'test/transcript-scope', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) =>
    texts.map((text) =>
      text.includes(TRANSCRIPT_QUERY) ? new Float32Array([1, 0]) : new Float32Array([0, 1]),
    ),
  embedPassages: async (texts) =>
    texts.map((text) =>
      text.includes(TRANSCRIPT_MARKER) ? new Float32Array([1, 0]) : new Float32Array([0, 1]),
    ),
}

function prepareWorkerProjection(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const projection = new SqliteSessionTranscriptSemanticProjection(sql, model)
    yield* projection.ensureSessions(['worker'])
    while ((yield* projection.prepareNextBatch(10)).prepared > 0) {
      // Drain only the explicitly requested transcript scope.
    }
  })
}

describe('SQLite Session transcript semantic search scope', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-transcript-scope-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('does not hydrate or decode the accumulated out-of-scope corpus', async () => {
    const runtime = makeRuntime(path.join(root, 'scope-local.sqlite'), model)
    runtimes.push(runtime)

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* prepareWorkerProjection(sql)
        yield* sql.unsafe(`
          WITH RECURSIVE node_sequence(value) AS (
            SELECT 1
            UNION ALL
            SELECT value + 1 FROM node_sequence WHERE value < 250
          )
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, created_order
          )
          SELECT
            'node-other-' || value, 'other', 'message', 'assistant', value,
            '{"text":"unrelated private transcript"}', '{}', NULL, value
          FROM node_sequence
        `)
        yield* sql`
          INSERT INTO session_transcript_embeddings (
            node_id, session_id, model_id, model_revision, dimensions, source_hash,
            vector, snapshot_revision, created_order, updated_at
          )
          SELECT id, session_id, ${model.metadata.id}, ${model.metadata.revision},
            ${model.metadata.dimensions}, ${'out-of-scope'}, ${Uint8Array.of(0)},
            ${2}, created_order, ${Date.now()}
          FROM session_nodes WHERE session_id = ${'other'}
        `
        return yield* new SqliteSessionTranscriptSemanticSearch(sql, model).search(
          TRANSCRIPT_QUERY,
          { sessionIds: ['worker'], truncated: false },
          1,
        )
      }),
    )

    expect(result).toMatchObject([{ session: { sessionId: 'worker' } }])
  })

  it('cannot return a deleted vector when its replacement preserves the row count', async () => {
    const runtime = makeRuntime(path.join(root, 'replacement.sqlite'), model)
    runtimes.push(runtime)

    const results = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* prepareWorkerProjection(sql)
        const search = new SqliteSessionTranscriptSemanticSearch(sql, model)
        const scope = { sessionIds: ['worker'], truncated: false } as const
        const before = yield* search.search(TRANSCRIPT_QUERY, scope, 1)
        const countsBefore = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_transcript_embeddings
          WHERE session_id = ${'worker'}
        `

        yield* sql`DELETE FROM session_nodes WHERE id = ${'node-worker-1'}`
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, created_order
          ) VALUES (
            ${'node-worker-replacement'}, ${'worker'}, ${'message'}, ${'assistant'}, ${3},
            ${'{"text":"new neural handshake verifier"}'}, ${'{}'},
            ${'worker:branch:main'}, ${2}
          )
        `
        yield* sql`
          INSERT INTO session_transcript_embeddings (
            node_id, session_id, model_id, model_revision, dimensions, source_hash,
            vector, snapshot_revision, created_order, updated_at
          ) VALUES (
            ${'node-worker-replacement'}, ${'worker'}, ${model.metadata.id},
            ${model.metadata.revision}, ${model.metadata.dimensions}, ${'replacement'},
            ${encodeFloat32Vector(new Float32Array([1, 0]))}, ${99}, ${2}, ${Date.now()}
          )
        `
        const after = yield* search.search(TRANSCRIPT_QUERY, scope, 1)
        const countsAfter = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_transcript_embeddings
          WHERE session_id = ${'worker'}
        `
        return { before, after, countsBefore, countsAfter }
      }),
    )

    expect(results.before[0]?.session.discoveryEvidence?.transcriptMatch?.nodeId).toBe(
      'node-worker-1',
    )
    expect(results.countsAfter).toEqual(results.countsBefore)
    expect(results.after[0]?.session.discoveryEvidence?.transcriptMatch?.nodeId).toBe(
      'node-worker-replacement',
    )
  })
})
