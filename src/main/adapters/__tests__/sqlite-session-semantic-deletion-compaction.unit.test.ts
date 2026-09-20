import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SESSION_DISCOVERY_DELETION_TOMBSTONE_LIMIT } from '../../services/session-host-search-schema'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SqliteSessionSemanticProjection } from '../sqlite-session-semantic-projection'
import { SqliteSessionSemanticSearch } from '../sqlite-session-semantic-search'
import { makeSessionQueryRuntime as makeRuntime } from './sqlite-session-query-test-layer'

const fakeModel: SessionEmbeddingModel = {
  metadata: { id: 'test/embedding', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
}

describe('SQLite Session semantic deletion compaction', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-semantic-compaction-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('forces a stale cache to rebuild after another cache acknowledges deletions', async () => {
    const runtime = makeRuntime(path.join(root, 'multi-cache.sqlite'), fakeModel)
    runtimes.push(runtime)

    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* new SqliteSessionSemanticProjection(sql, fakeModel).prepareNextBatch(10)
        const first = new SqliteSessionSemanticSearch(sql, fakeModel)
        const stale = new SqliteSessionSemanticSearch(sql, fakeModel)
        const request = {
          contractVersion: 2 as const,
          requestId: 'semantic-multi-cache-deletion',
          query: {
            operation: 'search' as const,
            query: 'session',
            mode: 'semantic' as const,
            limit: 3,
          },
        }
        const initialReadiness = yield* first.readiness()
        yield* first.search('session', undefined, request, initialReadiness, 3)
        yield* stale.search('session', undefined, request, initialReadiness, 3)

        yield* sql`DELETE FROM sessions WHERE id = ${'other'}`
        const deletionReadiness = yield* first.readiness()
        yield* first.search('session', undefined, request, deletionReadiness, 3)

        const compacted = yield* sql<{
          readonly tombstones: number
          readonly watermark: number
        }>`
          SELECT
            (SELECT COUNT(*) FROM session_discovery_embedding_deletions) AS tombstones,
            deletion_compaction_revision AS watermark
          FROM session_semantic_discovery_state WHERE singleton = 1
        `
        expect(compacted).toEqual([{ tombstones: 0, watermark: 2 }])

        const staleResult = yield* stale.search('session', undefined, request, deletionReadiness, 3)
        expect(staleResult.map((entry) => entry.session.sessionId)).not.toContain('other')
        expect(stale.diagnostics()).toEqual({ loadedRevision: 2, recordCount: 2 })
      }),
    )
  })

  it('bounds unacknowledged tombstones and advances the rebuild watermark', async () => {
    const runtime = makeRuntime(path.join(root, 'deletion-bound.sqlite'), fakeModel)
    runtimes.push(runtime)

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* new SqliteSessionSemanticProjection(sql, fakeModel).prepareNextBatch(10)
        yield* sql`
          WITH RECURSIVE sequence(value) AS (
            SELECT 0 UNION ALL SELECT value + 1 FROM sequence
            WHERE value + 1 < ${SESSION_DISCOVERY_DELETION_TOMBSTONE_LIMIT + 25}
          )
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at
          )
          SELECT printf('deletion-bound-%05d', value), printf('pi-bound-%05d', value),
            ${'/project-a'}, printf('Deletion bound %05d', value), 0, value, value
          FROM sequence
        `
        yield* sql`DELETE FROM sessions WHERE id LIKE ${'deletion-bound-%'}`
        return yield* sql<{ readonly tombstones: number; readonly watermark: number }>`
          SELECT
            (SELECT COUNT(*) FROM session_discovery_embedding_deletions) AS tombstones,
            deletion_compaction_revision AS watermark
          FROM session_semantic_discovery_state WHERE singleton = 1
        `
      }),
    )

    expect(result[0]?.tombstones).toBeLessThanOrEqual(SESSION_DISCOVERY_DELETION_TOMBSTONE_LIMIT)
    expect(result[0]?.watermark).toBeGreaterThan(0)
  })
})
