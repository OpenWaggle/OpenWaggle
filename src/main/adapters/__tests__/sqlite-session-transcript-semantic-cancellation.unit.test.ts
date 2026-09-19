import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SessionFlatVectorIndex } from '../session-flat-vector-index'
import { SqliteSessionTranscriptSemanticProjection } from '../sqlite-session-transcript-semantic-projection'
import { SqliteSessionTranscriptSemanticSearch } from '../sqlite-session-transcript-semantic-search'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

const cancellationModel: SessionEmbeddingModel = {
  metadata: { id: 'test/cancellation', revision: 'test-1', dimensions: 2, dtype: 'test' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0])),
}

describe('SQLite Session transcript semantic cancellation', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeSessionQueryRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-semantic-cancellation-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('passes interruption into the grouped scan so abandoned work stops', async () => {
    const runtime = makeSessionQueryRuntime(
      path.join(root, 'cancelled-transcript-scan.sqlite'),
      cancellationModel,
    )
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projection = new SqliteSessionTranscriptSemanticProjection(sql, cancellationModel)
        yield* projection.ensureSessions(['worker'])
        while ((yield* projection.prepareNextBatch(10)).prepared > 0) {
          // Prepare the complete bounded scope once.
        }
      }),
    )
    const scanStarted = Promise.withResolvers<void>()
    const scanStopped = Promise.withResolvers<void>()
    let scanSignal: AbortSignal | undefined
    let releaseScan: () => void = () => undefined
    vi.spyOn(SessionFlatVectorIndex.prototype, 'searchGroupedCooperatively').mockImplementation(
      (input) =>
        new Promise((resolve, reject) => {
          releaseScan = () => resolve([])
          scanSignal = input.signal
          input.signal?.addEventListener(
            'abort',
            () => {
              scanStopped.resolve()
              reject(input.signal?.reason)
            },
            { once: true },
          )
          scanStarted.resolve()
        }),
    )

    try {
      const fiber = runtime.runFork(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* new SqliteSessionTranscriptSemanticSearch(sql, cancellationModel).search(
            'cancel search',
            { sessionIds: ['worker'], truncated: false },
            1,
          )
        }),
      )
      await scanStarted.promise

      await Effect.runPromise(Fiber.interrupt(fiber))

      expect(scanSignal?.aborted).toBe(true)
      await scanStopped.promise
    } finally {
      releaseScan()
    }
  })
})
