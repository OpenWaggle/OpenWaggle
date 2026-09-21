import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SqliteSessionSemanticProjection } from '../sqlite-session-semantic-projection'
import { SqliteSessionSemanticSearch } from '../sqlite-session-semantic-search'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

const boundedPolicy = { recordLimit: 2 } as const
const immediateModel: SessionEmbeddingModel = {
  metadata: { id: 'test/storage-race', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
}

describe('SQLite Session semantic storage races', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeSessionQueryRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-semantic-storage-race-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('keeps publication bounded when the hot tier rotates during inference', async () => {
    let blockNextEmbedding = false
    let signalEmbeddingStarted: () => void = () => undefined
    let releaseEmbedding: () => void = () => undefined
    const embeddingStarted = new Promise<void>((resolve) => {
      signalEmbeddingStarted = resolve
    })
    const embeddingRelease = new Promise<void>((resolve) => {
      releaseEmbedding = resolve
    })
    const delayedModel: SessionEmbeddingModel = {
      ...immediateModel,
      embedPassages: async (texts) => {
        if (blockNextEmbedding) {
          blockNextEmbedding = false
          signalEmbeddingStarted()
          await embeddingRelease
        }
        return texts.map(() => new Float32Array([1, 0]))
      },
    }
    const runtime = makeSessionQueryRuntime(path.join(root, 'publication.sqlite'))
    runtimes.push(runtime)
    const projection = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return new SqliteSessionSemanticProjection(sql, delayedModel, boundedPolicy)
      }),
    )
    await runtime.runPromise(projection.prepareNextBatch(10))
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE sessions SET title = ${'Architecture hive refreshed'} WHERE id = ${'queen'}
        `
      }),
    )

    blockNextEmbedding = true
    const inFlight = runtime.runPromise(projection.prepareNextBatch(1))
    await embeddingStarted
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE sessions SET title = ${'Private other refreshed'}, updated_at = ${4}
          WHERE id = ${'other'}
        `
      }),
    )
    releaseEmbedding()
    await expect(inFlight).resolves.toMatchObject({ prepared: 1, pending: 1 })
    await runtime.runPromise(projection.prepareNextBatch(1))

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const embeddings = yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_discovery_embeddings ORDER BY session_id
        `
        const queue = yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_discovery_embedding_queue ORDER BY session_id
        `
        return { embeddings, queue, readiness: yield* projection.readiness() }
      }),
    )

    expect(result.embeddings.map(({ session_id }) => session_id)).toEqual(['other', 'queen'])
    expect(result.embeddings).toHaveLength(boundedPolicy.recordLimit)
    expect(result.queue).toEqual([])
    expect(result.readiness).toMatchObject({ status: 'partial', pendingCount: 0 })
  })

  it('does not report an under-limit projection as fresh after a Session is inserted', async () => {
    const runtime = makeSessionQueryRuntime(path.join(root, 'readiness.sqlite'))
    runtimes.push(runtime)
    const semantic = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return new SqliteSessionSemanticSearch(sql, immediateModel, { recordLimit: 4 })
      }),
    )
    await runtime.runPromise(semantic.projection.prepareNextBatch(10))
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at
          ) VALUES (
            ${'new-session'}, ${'pi-new-session'}, ${'/project-a'}, ${'New Session'}, ${0}, ${4}, ${4}
          )
        `
      }),
    )

    const stale = await runtime.runPromise(semantic.readiness())
    expect(stale).toMatchObject({ status: 'preparing', coverage: 3 / 4, pendingCount: 1 })
    expect(semantic.fresh(stale)).toBe(false)

    await runtime.runPromise(semantic.projection.prepareNextBatch(10))
    const fresh = await runtime.runPromise(semantic.readiness())
    expect(fresh).toMatchObject({ status: 'ready', coverage: 1, pendingCount: 0 })
    expect(semantic.fresh(fresh)).toBe(true)
  })

  it('prunes a cold queue before retrying a failed projection', async () => {
    const failedModel: SessionEmbeddingModel = {
      ...immediateModel,
      embedPassages: async () => {
        throw new Error('model unavailable')
      },
    }
    const runtime = makeSessionQueryRuntime(path.join(root, 'failure.sqlite'))
    runtimes.push(runtime)
    const projection = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return new SqliteSessionSemanticProjection(sql, failedModel, boundedPolicy)
      }),
    )
    await expect(runtime.runPromise(projection.prepareNextBatch(1))).rejects.toThrow(
      'Semantic Session projection failed.',
    )
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          WITH RECURSIVE sequence(value) AS (
            SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < 4
          )
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at
          )
          SELECT printf('failure-%d', value), printf('pi-failure-%d', value),
            ${'/project-a'}, printf('Failure %d', value), 0, value + 10, value + 10
          FROM sequence
        `
      }),
    )
    await expect(runtime.runPromise(projection.prepareNextBatch(1))).rejects.toThrow(
      'Semantic Session projection failed.',
    )

    const queued = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_discovery_embedding_queue ORDER BY session_id
        `
      }),
    )
    expect(queued.map(({ session_id }) => session_id)).toEqual(['failure-3', 'failure-4'])
    expect(queued).toHaveLength(boundedPolicy.recordLimit)

    await runtime.runPromise(projection.recordFailure('model unavailable'))
    const readiness = await runtime.runPromise(projection.readiness())
    expect(readiness).toMatchObject({ status: 'failed', pendingCount: 2 })
  })
})
