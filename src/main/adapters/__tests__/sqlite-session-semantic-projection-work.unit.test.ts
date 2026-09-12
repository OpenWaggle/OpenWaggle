import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SqliteSessionSemanticProjection } from '../sqlite-session-semantic-projection'
import { loadSessionSemanticProjectionRows } from '../sqlite-session-semantic-projection-batch'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

describe('SQLite Session semantic projection candidate work', () => {
  let root = ''
  let runtime: ReturnType<typeof makeSessionQueryRuntime> | undefined

  afterEach(async () => {
    await runtime?.dispose()
    if (root) await fs.rm(root, { recursive: true, force: true })
  })

  it('selects a bounded ordered queue page before loading Session documents', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-semantic-work-'))
    runtime = makeSessionQueryRuntime(path.join(root, 'projection.sqlite'))
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          WITH RECURSIVE sequence(value) AS (
            SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 99997
          )
          INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
          SELECT printf('session-%06d', value), printf('pi-%06d', value),
            'Queued Session', 1, value FROM sequence
        `
        yield* sql`UPDATE session_discovery_embedding_queue SET queued_at = 1`
        const query = loadSessionSemanticProjectionRows(sql, 2, 100_000)
        const [statement, parameters] = query.compile()
        const plan = yield* sql.unsafe<{ readonly detail: string }>(
          `EXPLAIN QUERY PLAN ${statement}`,
          parameters,
        )
        return { rows: yield* query, plan: plan.map(({ detail }) => detail).join('\n') }
      }),
    )

    expect(result.rows.map(({ session_id }) => session_id)).toEqual(['other', 'queen'])
    expect(result.plan).toContain('idx_session_discovery_embedding_queue_order')
    expect(result.plan).not.toContain('USE TEMP B-TREE FOR ORDER BY')
    expect(result.plan).not.toMatch(/(?:SCAN|MATERIALIZE|CO-ROUTINE) hot_sessions/)
  })

  it('rechecks hot-tier membership when insertion crosses capacity during inference', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-semantic-work-'))
    const activeRuntime = makeSessionQueryRuntime(path.join(root, 'capacity.sqlite'))
    runtime = activeRuntime
    let insertDuringInference = true
    const model: SessionEmbeddingModel = {
      metadata: { id: 'test/capacity', revision: 'test-1', dimensions: 2, dtype: 'test' },
      embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
      embedPassages: async (texts) => {
        if (insertDuringInference) {
          insertDuringInference = false
          await activeRuntime.runPromise(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              yield* sql`
                INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
                VALUES ('new-session', 'pi-new-session', 'New Session', 4, 4)
              `
            }),
          )
        }
        return texts.map(() => new Float32Array([1, 0]))
      },
    }
    const projection = await activeRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE session_discovery_embedding_queue SET queued_at = 1`
        return new SqliteSessionSemanticProjection(sql, model, { recordLimit: 3 })
      }),
    )

    // The oldest Session sorts first in the queue but leaves the hot tier while embedding.
    const discarded = await activeRuntime.runPromise(projection.prepareNextBatch(1))
    expect(discarded).toMatchObject({ prepared: 0, pending: 3 })
    await activeRuntime.runPromise(projection.prepareNextBatch(3))
    const result = await activeRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const embeddings = yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_discovery_embeddings ORDER BY session_id
        `
        return { embeddings, readiness: yield* projection.readiness() }
      }),
    )
    expect(result.embeddings.map(({ session_id }) => session_id)).toEqual([
      'new-session',
      'queen',
      'worker',
    ])
    expect(result.readiness).toMatchObject({ status: 'partial', pendingCount: 0, coverage: 3 / 4 })
  })
})
