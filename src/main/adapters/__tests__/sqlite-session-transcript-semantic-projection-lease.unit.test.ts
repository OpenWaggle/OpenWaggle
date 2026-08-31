import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SqliteSessionTranscriptSemanticProjection } from '../sqlite-session-transcript-semantic-projection'
import { projectionLeaseHeartbeat } from '../sqlite-session-transcript-semantic-projection-lease'
import { makeSessionQueryRuntime as makeRuntime } from './sqlite-session-query-test-layer'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('SQLite transcript semantic projection lease', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-transcript-projection-lease-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('does not publish a batch whose durable lease expired during inference', async () => {
    const inference = deferred<readonly Float32Array[]>()
    const model: SessionEmbeddingModel = {
      metadata: { id: 'test/lease', revision: 'test-1', dimensions: 2, dtype: 'test' },
      embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
      embedPassages: vi.fn(() => inference.promise),
    }
    const runtime = makeRuntime(path.join(root, 'expired.sqlite'), model)
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* new SqliteSessionTranscriptSemanticProjection(sql, model).ensureSessions(['worker'])
      }),
    )

    const preparing = runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* new SqliteSessionTranscriptSemanticProjection(sql, model).prepareNextBatch(10)
      }),
    )
    await vi.waitFor(() => expect(model.embedPassages).toHaveBeenCalledOnce())
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE session_transcript_semantic_leases SET expires_at = ${0}`
      }),
    )
    inference.resolve([new Float32Array([1, 0]), new Float32Array([0, 1])])

    await expect(preparing).resolves.toMatchObject({ prepared: 0 })
    const counts = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly embedded: number; readonly queued: number }>`
          SELECT
            (SELECT COUNT(*) FROM session_transcript_embeddings) AS embedded,
            (SELECT COUNT(*) FROM session_transcript_embedding_queue) AS queued
        `
      }),
    )
    expect(counts[0]).toEqual({ embedded: 0, queued: 2 })
  })

  it('renews the durable batch lease while inference remains active', async () => {
    const model: SessionEmbeddingModel = {
      metadata: { id: 'test/heartbeat', revision: 'test-1', dimensions: 2, dtype: 'test' },
      embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
      embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
    }
    const runtime = makeRuntime(path.join(root, 'heartbeat.sqlite'), model)
    runtimes.push(runtime)

    const expiries = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* new SqliteSessionTranscriptSemanticProjection(sql, model).ensureSessions(
          ['worker'],
          'heartbeat-operation',
        )
        const before = yield* sql<{ readonly expires_at: number }>`
          SELECT expires_at FROM session_transcript_semantic_leases
          WHERE operation_id = ${'heartbeat-operation'}
        `
        yield* Effect.raceFirst(
          projectionLeaseHeartbeat({
            sql,
            sessionIds: ['worker'],
            operationId: 'heartbeat-operation',
            intervalMs: 5,
          }),
          Effect.sleep(25),
        )
        const after = yield* sql<{ readonly expires_at: number }>`
          SELECT expires_at FROM session_transcript_semantic_leases
          WHERE operation_id = ${'heartbeat-operation'}
        `
        return { before: before[0]?.expires_at ?? 0, after: after[0]?.expires_at ?? 0 }
      }),
    )

    expect(expiries.after).toBeGreaterThan(expiries.before)
  })
})
