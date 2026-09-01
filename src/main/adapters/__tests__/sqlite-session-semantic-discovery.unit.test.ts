import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SqliteSessionSemanticProjection } from '../sqlite-session-semantic-projection'
import {
  SessionSemanticIndexSnapshotCache,
  SqliteSessionSemanticSearch,
} from '../sqlite-session-semantic-search'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

const fakeModel: SessionEmbeddingModel = {
  metadata: { id: 'test/embedding', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
}

describe('SQLite Session semantic discovery', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-semantic-discovery-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('serves strict semantic and fused hybrid discovery from the published snapshot', async () => {
    const runtime = makeRuntime(path.join(root, 'semantic-search.sqlite'), fakeModel)
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* new SqliteSessionSemanticProjection(sql, fakeModel).prepareNextBatch(10)
      }),
    )
    const semantic = await executeQuery(runtime, {
      operation: 'search',
      query: 'unrelated concept',
      mode: 'semantic',
      limit: 2,
    })
    const hybrid = await executeQuery(runtime, {
      operation: 'search',
      query: 'Validate migration',
      mode: 'hybrid',
      limit: 3,
    })

    expect(semantic.outcome).toMatchObject({
      operation: 'search',
      searchBackend: 'semantic',
      semanticReadiness: { status: 'ready', snapshotRevision: 1 },
      sessions: [
        { discoveryEvidence: { matchKind: 'semantic', rank: 1 } },
        { discoveryEvidence: { matchKind: 'semantic', rank: 2 } },
      ],
    })
    expect(hybrid.outcome).toMatchObject({ operation: 'search', searchBackend: 'hybrid' })
    if (hybrid.outcome.operation !== 'search' || !('sessions' in hybrid.outcome)) {
      throw new Error('Expected hybrid Session discovery results.')
    }
    expect(hybrid.outcome.sessions[0]).toMatchObject({
      sessionId: 'worker',
      discoveryEvidence: { matchKind: 'hybrid', rank: 1 },
    })
  })

  it('keeps a newer index snapshot when an older refresh request arrives out of order', async () => {
    const cache = new SessionSemanticIndexSnapshotCache()
    let markNewRefreshStarted: (() => void) | undefined
    const newRefreshStarted = new Promise<void>((resolve) => {
      markNewRefreshStarted = resolve
    })
    let releaseNewRefresh: (() => void) | undefined
    const newRefreshBarrier = new Promise<void>((resolve) => {
      releaseNewRefresh = resolve
    })
    let oldRefreshes = 0

    const newer = Effect.runPromise(
      cache.search({
        minimumRevision: 2,
        refresh: () =>
          Effect.promise(async () => {
            markNewRefreshStarted?.()
            await newRefreshBarrier
            return {
              revision: 2,
              rebuild: true,
              records: [{ sessionId: 'new-session', vector: new Float32Array([1, 0]) }],
              deletedSessionIds: [],
            }
          }),
        query: new Float32Array([1, 0]),
        limit: 1,
        allowedSessionIds: new Set(['new-session']),
      }),
    )
    await newRefreshStarted
    const older = Effect.runPromise(
      cache.search({
        minimumRevision: 1,
        refresh: () => {
          oldRefreshes += 1
          return Effect.succeed({
            revision: 1,
            rebuild: true,
            records: [{ sessionId: 'old-session', vector: new Float32Array([1, 0]) }],
            deletedSessionIds: [],
          })
        },
        query: new Float32Array([1, 0]),
        limit: 1,
        allowedSessionIds: new Set(['new-session', 'old-session']),
      }),
    )
    releaseNewRefresh?.()

    await expect(newer).resolves.toMatchObject({
      revision: 2,
      matches: [{ sessionId: 'new-session' }],
    })
    await expect(older).resolves.toMatchObject({
      revision: 2,
      matches: [{ sessionId: 'new-session' }],
    })
    expect(oldRefreshes).toBe(0)
    expect(cache.diagnostics()).toEqual({ loadedRevision: 2, recordCount: 1 })
  })

  it('evicts a deleted Session from an already-loaded semantic index snapshot', async () => {
    const runtime = makeRuntime(path.join(root, 'semantic-deletion.sqlite'), fakeModel)
    runtimes.push(runtime)

    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* new SqliteSessionSemanticProjection(sql, fakeModel).prepareNextBatch(10)
        const semantic = new SqliteSessionSemanticSearch(sql, fakeModel)
        const request = {
          contractVersion: 2 as const,
          requestId: 'semantic-deletion',
          query: {
            operation: 'search' as const,
            query: 'session',
            mode: 'semantic' as const,
            limit: 3,
          },
        }
        const initialReadiness = yield* semantic.readiness()
        yield* semantic.search('session', undefined, request, initialReadiness, 3)

        expect(semantic.diagnostics()).toEqual({ loadedRevision: 1, recordCount: 3 })

        yield* sql`DELETE FROM sessions WHERE id = ${'other'}`
        const deletionReadiness = yield* semantic.readiness()
        yield* semantic.search('session', undefined, request, deletionReadiness, 3)

        expect(deletionReadiness).toMatchObject({ snapshotRevision: 2 })
        expect(semantic.diagnostics()).toEqual({ loadedRevision: 2, recordCount: 2 })
      }),
    )
  })

  it('sanitizes global semantic readiness for a restricted discovery authority', async () => {
    const runtime = makeRuntime(path.join(root, 'scoped-semantic-readiness.sqlite'), fakeModel)
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* new SqliteSessionSemanticProjection(sql, fakeModel).prepareNextBatch(10)
        yield* sql`
          UPDATE session_semantic_discovery_state
          SET snapshot_revision = ${999}, pending_count = ${41},
            preparation_operation_id = ${'private-global-operation'},
            failure_message = ${'private-global-failure'}, updated_at = ${123456}
          WHERE singleton = ${1}
        `
      }),
    )
    const result = await executeQuery(
      runtime,
      { operation: 'search', query: 'migration', mode: 'semantic', limit: 2 },
      {
        profileId: 'restricted-discoverer',
        profileName: 'restricted-discoverer',
        capabilities: ['sessions:discover'],
        scope: { projectPaths: ['/project-a'] },
        authorizationCeiling: 'ask-for-approval',
      },
    )

    expect(result.outcome).toMatchObject({
      operation: 'search',
      semanticReadiness: { status: 'ready' },
    })
    if (result.outcome.operation !== 'search') throw new Error('Expected a search result.')
    expect(result.outcome.semanticReadiness).toEqual({ status: 'ready' })
    expect(JSON.stringify(result)).not.toContain('private-global')
    expect(result.outcome.semanticReadiness).not.toHaveProperty('snapshotRevision')
    expect(result.outcome.semanticReadiness).not.toHaveProperty('pendingCount')
    expect(result.outcome.semanticReadiness).not.toHaveProperty('updatedAt')
  })

  it('waits only when fresh semantic discovery has an explicit bounded timeout', async () => {
    const runtime = makeRuntime(path.join(root, 'fresh-semantic-search.sqlite'), fakeModel)
    runtimes.push(runtime)
    const withoutWait = await executeQuery(runtime, {
      operation: 'search',
      query: 'migration',
      mode: 'hybrid',
      requireFresh: true,
      limit: 3,
    })
    const preparation = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        runtime
          .runPromise(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              yield* new SqliteSessionSemanticProjection(sql, fakeModel).prepareNextBatch(10)
            }),
          )
          .then(() => resolve(), reject)
      }, 20)
    })
    const afterWait = await executeQuery(runtime, {
      operation: 'search',
      query: 'migration',
      mode: 'hybrid',
      requireFresh: true,
      waitTimeoutMs: 500,
      limit: 3,
    })
    await preparation

    expect(withoutWait.outcome).toMatchObject({
      operation: 'search',
      semanticReadiness: { status: 'unavailable', pendingCount: 3 },
      error: { code: 'semantic_not_ready' },
    })
    expect(afterWait.outcome).toMatchObject({
      operation: 'search',
      searchBackend: 'hybrid',
      semanticReadiness: { status: 'ready', pendingCount: 0 },
    })
  })
})
