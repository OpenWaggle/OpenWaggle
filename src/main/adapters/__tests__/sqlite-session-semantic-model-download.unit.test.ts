import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import type { SessionEmbeddingModelAvailability } from '../session-embedding-model-files'
import { SqliteSessionSemanticProjection } from '../sqlite-session-semantic-projection'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

const fakeModel: SessionEmbeddingModel = {
  metadata: { id: 'test/embedding', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
}

const RESTRICTED: LocalSessionProfileAuthority = {
  profileId: 'restricted-discoverer',
  profileName: 'restricted-discoverer',
  capabilities: ['sessions:discover'],
  scope: { projectPaths: ['/project-a'] },
  authorizationCeiling: 'ask-for-approval',
}

/**
 * The model is fetched on first use (session-embedding-model-files.ts): search without a wait does
 * not wait for the download, and a required-fresh search waits for it until its timeout.
 */
describe('Session discovery before the embedding model arrives', () => {
  let root = ''
  const runtimes: ReturnType<typeof makeRuntime>[] = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-semantic-model-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('degrades to lexical search, with the reason, while the model is still downloading', async () => {
    const queries: string[] = []
    const downloading: SessionEmbeddingModel = {
      ...fakeModel,
      embedQueries: async (texts) => {
        queries.push(...texts)
        return texts.map(() => new Float32Array([1, 0]))
      },
      availability: async () => ({
        state: 'downloading',
        receivedBytes: 27_000_000,
        totalBytes: 135_000_000,
      }),
    }
    const runtime = makeRuntime(path.join(root, 'semantic-downloading.sqlite'), downloading)
    runtimes.push(runtime)
    // Embeddings an earlier build made with its bundled copy of the model.
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* new SqliteSessionSemanticProjection(sql, fakeModel).prepareNextBatch(10)
      }),
    )

    const result = await executeQuery(runtime, {
      operation: 'search',
      query: 'Validate migration',
      mode: 'hybrid',
      limit: 3,
    })

    expect(result.outcome).toMatchObject({
      operation: 'search',
      searchBackend: 'lexical',
      semanticReadiness: {
        model: { state: 'downloading', receivedBytes: 27_000_000 },
        reason: expect.stringMatching(/Downloading the Session search model \(20% of 135 MB\)/),
      },
      sessions: [{ sessionId: 'worker' }],
    })
    expect(queries).toEqual([])
  })

  /** A runtime whose index an earlier build prepared, so it would say ready without the model. */
  async function preparedRuntime(name: string, availability: SessionEmbeddingModelAvailability) {
    return preparedRuntimeWith(name, async () => availability)
  }

  async function preparedRuntimeWith(
    name: string,
    availability: () => Promise<SessionEmbeddingModelAvailability>,
  ) {
    const runtime = makeRuntime(path.join(root, `${name}.sqlite`), { ...fakeModel, availability })
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* new SqliteSessionSemanticProjection(sql, fakeModel).prepareNextBatch(10)
      }),
    )
    return runtime
  }

  it.each([
    [{ state: 'missing' } as const, 'preparing'],
    [{ state: 'downloading', receivedBytes: 1, totalBytes: 2 } as const, 'preparing'],
    [{ state: 'offline', reason: 'ENOTFOUND', retryAt: 1 } as const, 'unavailable'],
  ])('says %o is not ready in semantic mode', async (model, status) => {
    const runtime = await preparedRuntime(`semantic-${model.state}`, model)

    const result = await executeQuery(runtime, {
      operation: 'search',
      query: 'Validate migration',
      mode: 'semantic',
      limit: 3,
    })

    expect(result.outcome).toMatchObject({
      operation: 'search',
      semanticReadiness: { status, model: { state: model.state } },
    })
  })

  it('tells a restricted caller the model is missing, with the reason, not that it is ready', async () => {
    const runtime = await preparedRuntime('semantic-restricted', { state: 'missing' })

    const result = await executeQuery(
      runtime,
      { operation: 'search', query: 'migration', mode: 'semantic', limit: 2 },
      RESTRICTED,
    )

    if (result.outcome.operation !== 'search') throw new Error('Expected a search result.')
    expect(result.outcome.semanticReadiness).toEqual({
      status: 'preparing',
      model: { state: 'missing' },
      reason: expect.stringContaining('has not been downloaded yet; search matches words'),
    })
  })

  it.each<{ readonly model: SessionEmbeddingModelAvailability; readonly name: string }>([
    { model: { state: 'missing' }, name: 'missing' },
    { model: { state: 'failed', reason: 'HTTP 503', retryAt: 1 }, name: 'failed' },
  ])(
    'tells a restricted caller a failed index is unavailable while the model is $name',
    async ({ model }) => {
      const runtime = await preparedRuntime(`semantic-restricted-${model.state}`, model)
      await runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* new SqliteSessionSemanticProjection(sql, fakeModel).recordFailure('disk full')
        }),
      )

      const result = await executeQuery(
        runtime,
        { operation: 'search', query: 'migration', mode: 'semantic', limit: 2 },
        RESTRICTED,
      )

      if (result.outcome.operation !== 'search') throw new Error('Expected a search result.')
      expect(result.outcome.semanticReadiness).toMatchObject({
        status: 'unavailable',
        model: { state: model.state },
      })
    },
  )

  it.each<{ readonly model: SessionEmbeddingModelAvailability; readonly name: string }>([
    { model: { state: 'missing' }, name: 'missing' },
    {
      model: { state: 'downloading', receivedBytes: 0, totalBytes: 135_000_000 },
      name: 'downloading',
    },
  ])(
    'waits for a $name model a required-fresh search can still get, then searches semantically',
    async ({ model }) => {
      // The readiness read starts the download; it arrives within the wait.
      let arrived = false
      const runtime = await preparedRuntimeWith(`semantic-arrives-${model.state}`, async () =>
        arrived ? { state: 'ready' } : model,
      )
      setTimeout(() => {
        arrived = true
      }, 30)

      const result = await executeQuery(runtime, {
        operation: 'search',
        query: 'Validate migration',
        mode: 'semantic',
        requireFresh: true,
        waitTimeoutMs: 2_000,
        limit: 3,
      })

      expect(result.outcome).toMatchObject({
        operation: 'search',
        searchBackend: 'semantic',
        semanticReadiness: { status: 'ready' },
      })
    },
  )

  it.each<{
    readonly model: SessionEmbeddingModelAvailability
    readonly name: string
    readonly reason: string
  }>([
    {
      model: { state: 'failed', reason: 'HTTP 503', retryAt: Date.now() + 60_000 },
      name: 'failed',
      reason: 'HTTP 503',
    },
    {
      model: { state: 'offline', reason: 'fetch failed', retryAt: Date.now() + 60_000 },
      name: 'offline',
      reason: 'fetch failed',
    },
  ])(
    'answers at once, with the reason, when the model download $name',
    async ({ model, reason }) => {
      const runtime = await preparedRuntime(`semantic-stopped-${model.state}`, model)
      const startedAt = Date.now()

      const result = await executeQuery(runtime, {
        operation: 'search',
        query: 'Validate migration',
        mode: 'semantic',
        requireFresh: true,
        waitTimeoutMs: 5_000,
        limit: 3,
      })

      expect(Date.now() - startedAt).toBeLessThan(2_000)
      expect(result.outcome).toMatchObject({
        operation: 'search',
        semanticReadiness: {
          model: { state: model.state },
          reason: expect.stringContaining(reason),
        },
        error: { code: 'semantic_not_ready' },
      })
    },
  )
})
