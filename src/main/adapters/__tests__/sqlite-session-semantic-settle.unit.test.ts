import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SqliteSessionSemanticProjection } from '../sqlite-session-semantic-projection'
import { makeSessionQueryRuntime as makeRuntime } from './sqlite-session-query-test-layer'

describe('Session discovery re-embedding waits until a Session settles (D3)', () => {
  let root = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-semantic-settle-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('skips Sessions that changed within the settle time and embeds them once quiet', async () => {
    const runtime = makeRuntime(path.join(root, 'settle.sqlite'))
    runtimes.push(runtime)
    const embedded: string[][] = []
    const model: SessionEmbeddingModel = {
      metadata: { id: 'test/embedding', revision: 'test-1', dimensions: 2, dtype: 'test' },
      embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0])),
      embedPassages: async (texts) => {
        embedded.push([...texts])
        return texts.map(() => new Float32Array([1, 0]))
      },
    }
    let now = Date.now()
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projection = new SqliteSessionSemanticProjection(sql, model, undefined, {
          settleMs: 15_000,
          now: () => now,
        })
        const whileChanging = yield* projection.prepareNextBatch(10)
        now += 60_000
        const settled = yield* projection.prepareNextBatch(10)
        return { whileChanging, settled }
      }),
    )

    expect(result.whileChanging).toMatchObject({ prepared: 0 })
    expect(embedded).toHaveLength(1)
    expect(result.settled).toMatchObject({ prepared: 3 })
  })
})
