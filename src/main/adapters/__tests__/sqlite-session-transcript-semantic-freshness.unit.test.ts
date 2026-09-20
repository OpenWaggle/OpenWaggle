import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SqliteSessionTranscriptSemanticProjection } from '../sqlite-session-transcript-semantic-projection'
import { SqliteSessionTranscriptSemanticSearch } from '../sqlite-session-transcript-semantic-search'
import { makeSessionQueryRuntime as makeRuntime } from './sqlite-session-query-test-layer'

const embeddingModel: SessionEmbeddingModel = {
  metadata: { id: 'test/transcript-freshness', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
}

describe('SQLite Session transcript semantic freshness', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-transcript-freshness-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('reconciles a transcript write that races scope preparation before reporting freshness', async () => {
    const runtime = makeRuntime(path.join(root, 'scope-freshness-race.sqlite'), embeddingModel)
    runtimes.push(runtime)

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projection = new SqliteSessionTranscriptSemanticProjection(sql, embeddingModel)
        const search = new SqliteSessionTranscriptSemanticSearch(sql, embeddingModel)
        const scope = { sessionIds: ['worker'], truncated: false } as const
        yield* projection.ensureSessions(scope.sessionIds)
        while ((yield* projection.prepareNextBatch(10)).prepared > 0) {
          // Establish a ready scope before the concurrent write.
        }
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, created_order
          ) VALUES (
            ${'node-worker-after-prepare'}, ${'worker'}, ${'message'}, ${'assistant'}, ${3},
            ${JSON.stringify({ text: 'committed after scope preparation' })},
            ${'{}'}, ${'worker:branch:main'}, ${2}
          )
        `
        const afterRace = yield* search.readiness(scope)
        const revisions = yield* sql<{
          readonly source_revision: number
          readonly prepared_source_revision: number
          readonly queued: number
        }>`
          SELECT source_revision, prepared_source_revision,
            (SELECT COUNT(*) FROM session_transcript_embedding_queue
              WHERE session_id = ${'worker'}) AS queued
          FROM session_transcript_semantic_scopes WHERE session_id = ${'worker'}
        `
        const waited = yield* search.waitForFresh(scope, afterRace, 1)
        yield* projection.prepareNextBatch(10)
        const afterProjection = yield* search.readiness(scope)
        return { afterRace, revisions: revisions[0], waited, afterProjection }
      }),
    )

    expect(result.afterRace).toMatchObject({ status: 'preparing', pendingCount: 1 })
    expect(result.revisions).toEqual({
      source_revision: 1,
      prepared_source_revision: 1,
      queued: 1,
    })
    expect(result.waited.status).toBe('preparing')
    expect(result.afterProjection).toMatchObject({ status: 'ready', pendingCount: 0 })
  })
})
