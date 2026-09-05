import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SessionDiscoveryWindowStore } from '../session-discovery-window-store'
import { searchSessions } from '../sqlite-session-discovery'
import { SqliteSessionSemanticSearch } from '../sqlite-session-semantic-search'
import { SqliteSessionTranscriptSemanticSearch } from '../sqlite-session-transcript-semantic-search'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

const storagePolicy = { recordLimit: 2 } as const
const fakeModel: SessionEmbeddingModel = {
  metadata: { id: 'test/bounded-embedding', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
}

describe('SQLite Session semantic discovery storage bound', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeSessionQueryRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-semantic-storage-bound-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('bounds hot vectors, reports cold coverage, and settles after hot-tier rotation', async () => {
    const runtime = makeSessionQueryRuntime(path.join(root, 'bounded.sqlite'), fakeModel)
    runtimes.push(runtime)

    const initial = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const semantic = new SqliteSessionSemanticSearch(sql, fakeModel, storagePolicy)
        const before = yield* semantic.readiness()
        const prepared = yield* semantic.projection.prepareNextBatch(10)
        const readiness = yield* semantic.readiness()
        const request = {
          contractVersion: 2 as const,
          requestId: 'bounded-semantic-search',
          query: {
            operation: 'search' as const,
            query: 'session',
            mode: 'semantic' as const,
            limit: 3,
          },
        }
        yield* semantic.search('session', undefined, request, readiness, 3)
        const embeddings = yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_discovery_embeddings ORDER BY session_id
        `
        const queue = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_discovery_embedding_queue
        `
        const hybrid = yield* searchSessions(
          sql,
          undefined,
          {
            contractVersion: 2,
            requestId: 'bounded-hybrid-search',
            query: {
              operation: 'search',
              query: 'Private other',
              mode: 'hybrid',
              limit: 3,
            },
          },
          new SessionDiscoveryWindowStore(),
          semantic,
          new SqliteSessionTranscriptSemanticSearch(sql, fakeModel),
        )
        return {
          before,
          prepared,
          readiness,
          embeddings,
          pending: queue[0]?.count,
          diagnostics: semantic.diagnostics(),
          fresh: semantic.fresh(readiness),
          hybrid,
        }
      }),
    )

    expect(initial.before).toMatchObject({ status: 'unavailable', pendingCount: 2 })
    expect(initial.prepared).toMatchObject({ prepared: 2, pending: 0 })
    expect(initial.readiness).toMatchObject({
      status: 'partial',
      coverage: 2 / 3,
      pendingCount: 0,
      reason: expect.stringContaining('2 most recently updated Sessions'),
    })
    expect(initial.embeddings.map((row) => row.session_id)).toEqual(['queen', 'worker'])
    expect(initial.pending).toBe(0)
    expect(initial.diagnostics.recordCount).toBe(2)
    expect(initial.fresh).toBe(true)
    expect(initial.hybrid.outcome).toMatchObject({
      operation: 'search',
      searchBackend: 'lexical',
      requestedSearchMode: 'hybrid',
      semanticReadiness: { status: 'partial', coverage: 2 / 3 },
      degradation: {
        from: 'hybrid',
        to: 'lexical',
        reason: 'semantic_partial_coverage',
      },
      sessions: [{ sessionId: 'other' }],
    })

    const rotated = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const semantic = new SqliteSessionSemanticSearch(sql, fakeModel, storagePolicy)
        const readiness = yield* semantic.readiness()
        const request = {
          contractVersion: 2 as const,
          requestId: 'bounded-semantic-rotation',
          query: {
            operation: 'search' as const,
            query: 'session',
            mode: 'semantic' as const,
            limit: 3,
          },
        }
        yield* semantic.search('session', undefined, request, readiness, 3)
        yield* sql`
          UPDATE sessions
          SET title = ${'Recently active private other'}, updated_at = ${4}
          WHERE id = ${'other'}
        `
        const prepared = yield* semantic.projection.prepareNextBatch(10)
        const settled = yield* semantic.projection.prepareNextBatch(10)
        const after = yield* semantic.readiness()
        yield* semantic.search('session', undefined, request, after, 3)
        const embeddings = yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_discovery_embeddings ORDER BY session_id
        `
        const queue = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_discovery_embedding_queue
        `
        return {
          prepared,
          settled,
          after,
          embeddings,
          pending: queue[0]?.count,
          diagnostics: semantic.diagnostics(),
        }
      }),
    )

    expect(rotated.prepared).toMatchObject({ prepared: 1, pending: 0 })
    expect(rotated.settled).toEqual({ prepared: 0, pending: 0 })
    expect(rotated.after).toMatchObject({ status: 'partial', coverage: 2 / 3, pendingCount: 0 })
    expect(rotated.embeddings.map((row) => row.session_id)).toEqual(['other', 'queen'])
    expect(rotated.pending).toBe(0)
    expect(rotated.diagnostics.recordCount).toBe(2)
  })
})
