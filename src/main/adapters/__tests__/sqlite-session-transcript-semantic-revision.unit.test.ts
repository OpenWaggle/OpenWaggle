import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SessionTranscriptSemanticIndexCache } from '../session-transcript-semantic-index-cache'
import { maintainTranscriptSemanticStorage } from '../sqlite-session-transcript-semantic-maintenance'
import { SqliteSessionTranscriptSemanticProjection } from '../sqlite-session-transcript-semantic-projection'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

const model: SessionEmbeddingModel = {
  metadata: { id: 'test/transcript-revision', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([0, 1])),
  embedPassages: async (texts) =>
    texts.map((text) =>
      text.includes('neural handshake verifier')
        ? new Float32Array([1, 0])
        : new Float32Array([0, 1]),
    ),
}

describe('SQLite Session transcript semantic revision', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeSessionQueryRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-transcript-revision-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('does not reuse a cached vector after the highest revision is deleted and replaced', async () => {
    const runtime = makeSessionQueryRuntime(path.join(root, 'revision-reuse.sqlite'), model)
    runtimes.push(runtime)

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projection = new SqliteSessionTranscriptSemanticProjection(sql, model)
        yield* projection.ensureSessions(['worker'])
        yield* projection.prepareNextBatch(1)
        yield* projection.prepareNextBatch(1)

        const cache = new SessionTranscriptSemanticIndexCache(sql, model)
        const before = yield* cache.load(['worker'])
        yield* sql`DELETE FROM session_nodes WHERE id = ${'node-worker-2'}`
        yield* maintainTranscriptSemanticStorage(sql, Date.now())
        const afterDeletion = yield* sql<{ readonly snapshot_revision: number }>`
          SELECT snapshot_revision FROM session_semantic_transcript_state WHERE singleton = 1
        `
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, parent_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, path_depth, created_order
          ) VALUES (
            ${'node-worker-3'}, ${'worker'}, ${'node-worker-1'}, ${'message'},
            ${'assistant'}, ${3}, ${'{"text":"replacement answer"}'}, ${'{}'},
            ${'worker:branch:main'}, ${1}, ${2}
          )
        `
        yield* projection.ensureSessions(['worker'])
        yield* projection.prepareNextBatch(1)
        const after = yield* cache.load(['worker'])
        const revisions = yield* sql<{
          readonly node_id: string
          readonly snapshot_revision: number
        }>`
          SELECT node_id, snapshot_revision FROM session_transcript_embeddings
          WHERE session_id = ${'worker'} ORDER BY node_id
        `
        return { before, after, afterDeletion: afterDeletion[0], revisions }
      }),
    )

    expect(result.afterDeletion?.snapshot_revision).toBe(2)
    expect(result.revisions).toEqual([
      { node_id: 'node-worker-1', snapshot_revision: 1 },
      { node_id: 'node-worker-3', snapshot_revision: 3 },
    ])
    expect(result.after).not.toBe(result.before)
    expect(result.after.searchGrouped(new Float32Array([0, 1]), 2, new Set(['worker']))).toEqual([
      expect.objectContaining({ matchedRecordId: 'node-worker-3' }),
    ])
  })

  it('does not lower the high-water when another writer advances it before a status upsert', async () => {
    const runtime = makeSessionQueryRuntime(path.join(root, 'status-race.sqlite'), model)
    runtimes.push(runtime)

    const revisions = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projection = new SqliteSessionTranscriptSemanticProjection(sql, model)
        yield* projection.ensureSessions(['worker'])
        yield* sql.unsafe(`
          CREATE TRIGGER advance_transcript_revision_before_status_insert
          BEFORE INSERT ON session_semantic_transcript_state BEGIN
            UPDATE session_semantic_transcript_state
            SET snapshot_revision = CASE
              WHEN new.status = 'failed' THEN 100
              WHEN new.status = 'ready' THEN 200
              ELSE snapshot_revision END
            WHERE singleton = 1;
          END
        `)
        yield* projection.recordFailure('test failure')
        const afterFailure = yield* sql<{ readonly snapshot_revision: number }>`
          SELECT snapshot_revision FROM session_semantic_transcript_state WHERE singleton = 1
        `
        yield* projection.prepareNextBatch(10)
        const afterPublish = yield* sql<{ readonly snapshot_revision: number }>`
          SELECT snapshot_revision FROM session_semantic_transcript_state WHERE singleton = 1
        `
        return {
          afterFailure: afterFailure[0]?.snapshot_revision,
          afterPublish: afterPublish[0]?.snapshot_revision,
        }
      }),
    )

    expect(revisions).toEqual({ afterFailure: 100, afterPublish: 200 })
  })
})
