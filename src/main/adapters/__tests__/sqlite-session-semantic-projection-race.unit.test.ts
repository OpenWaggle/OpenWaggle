import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SqliteSessionSemanticProjection } from '../sqlite-session-semantic-projection'
import { makeSessionQueryRuntime as makeRuntime } from './sqlite-session-query-test-layer'

describe('SQLite Session semantic projection publication', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-semantic-projection-race-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('does not publish a stale document when its source changes during embedding', async () => {
    let releaseEmbedding: (() => void) | undefined
    let signalEmbeddingStarted: (() => void) | undefined
    const embeddingStarted = new Promise<void>((resolve) => {
      signalEmbeddingStarted = resolve
    })
    const embeddingRelease = new Promise<void>((resolve) => {
      releaseEmbedding = resolve
    })
    const embeddedDocuments: string[] = []
    const delayedModel: SessionEmbeddingModel = {
      metadata: { id: 'test/embedding', revision: 'test-1', dimensions: 2, dtype: 'test' },
      embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
      embedPassages: async (texts) => {
        embeddedDocuments.push(...texts)
        signalEmbeddingStarted?.()
        await embeddingRelease
        return texts.map(() => new Float32Array([1, 0]))
      },
    }
    const runtime = makeRuntime(path.join(root, 'projection-race.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE session_discovery_embedding_queue SET queued_at = ${1}`
      }),
    )

    const firstPreparation = runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* new SqliteSessionSemanticProjection(sql, delayedModel).prepareNextBatch(1)
      }),
    )
    await embeddingStarted
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE sessions SET title = title || ${' changed'}`
        yield* sql`UPDATE session_discovery_embedding_queue SET queued_at = ${1}`
      }),
    )
    releaseEmbedding?.()
    await expect(firstPreparation).resolves.toMatchObject({ prepared: 0, pending: 3 })

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const prepared = yield* new SqliteSessionSemanticProjection(
          sql,
          delayedModel,
        ).prepareNextBatch(1)
        const embeddings = yield* sql<{ readonly source_hash: string }>`
          SELECT source_hash FROM session_discovery_embeddings
        `
        return { prepared, embeddings }
      }),
    )

    expect(result.prepared).toMatchObject({ prepared: 1, pending: 2 })
    expect(embeddedDocuments).toHaveLength(2)
    expect(embeddedDocuments[1]).not.toBe(embeddedDocuments[0])
    expect(result.embeddings).toEqual([
      {
        source_hash: createHash('sha256')
          .update(embeddedDocuments[1] ?? '')
          .digest('hex'),
      },
    ])
  })
})
