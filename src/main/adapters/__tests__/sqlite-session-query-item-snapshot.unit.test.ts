import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readItems } from '../sqlite-session-query-items'
import { makeSessionQueryRuntime as makeRuntime } from './sqlite-session-query-test-layer'

describe('SQLite Session item snapshots', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-item-snapshot-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('pins snapshot metadata and page rows to one read transaction', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'transactional-read.sqlite'))
    runtimes.push(runtime)
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const transaction = vi.spyOn(sql, 'withTransaction')
        try {
          const response = yield* readItems(sql, {
            contractVersion: SESSION_QUERY_CONTRACT_VERSION,
            requestId: 'transactional-snapshot',
            query: { operation: 'items', sessionId: 'worker', limit: 1 },
          })
          return { response, transactionCount: transaction.mock.calls.length }
        } finally {
          transaction.mockRestore()
        }
      }),
    )

    expect(result.transactionCount).toBe(1)
    expect(result.response.outcome).toMatchObject({
      operation: 'items',
      highWaterMark: 1,
      items: [{ nodeId: 'node-worker-1' }],
    })
  })
})
