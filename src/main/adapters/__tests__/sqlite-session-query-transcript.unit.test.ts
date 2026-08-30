import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

describe('SQLite Session transcript queries', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-transcript-query-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('treats punctuation-heavy lexical input as text instead of FTS syntax', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'search-punctuation.sqlite'))
    runtimes.push(runtime)
    for (const query of ['abc-def', 'C++', 'foo:bar', '"unmatched']) {
      const result = await executeQuery(runtime, { operation: 'search', query, limit: 10 })
      expect(result.outcome).toMatchObject({ operation: 'search' })
      expect(result.outcome).not.toHaveProperty('error')
    }
  })

  it('pages transcript items and omits queued bodies unless explicitly included', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'read.sqlite'))
    runtimes.push(runtime)
    const items = await executeQuery(runtime, { operation: 'items', sessionId: 'worker', limit: 1 })
    const queue = await executeQuery(runtime, { operation: 'queue-list', sessionId: 'worker' })

    expect(items.outcome).toMatchObject({
      operation: 'items',
      items: [
        {
          nodeId: 'node-worker-1',
          runId: 'run-worker',
          content: { text: 'neural handshake verifier' },
        },
      ],
    })
    expect(queue.outcome).toMatchObject({
      operation: 'queue-list',
      omittedBodyCount: 1,
      items: [{ followUpId: 'follow-up-1' }],
    })
    expect(JSON.stringify(queue)).not.toContain('"next"')
  })

  it('fixes a transcript high-water mark across pages while new items are committed', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'snapshot-read.sqlite'))
    runtimes.push(runtime)
    const first = await executeQuery(runtime, { operation: 'items', sessionId: 'worker', limit: 1 })
    if (first.outcome.operation !== 'items' || !('items' in first.outcome)) {
      throw new Error('Expected transcript items.')
    }
    const highWaterMark = first.outcome.highWaterMark
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms,
            content_json, metadata_json, created_order
          ) VALUES (
            ${'node-worker-live'}, ${'worker'}, ${'message'}, ${'assistant'}, ${3},
            ${'{"text":"committed after snapshot"}'}, ${'{}'}, ${2}
          )
        `
      }),
    )
    const second = await executeQuery(runtime, {
      operation: 'items',
      sessionId: 'worker',
      limit: 10,
      afterCreatedOrder: 0,
      throughCreatedOrder: highWaterMark,
    })

    expect(second.outcome).toMatchObject({
      operation: 'items',
      highWaterMark,
      items: [{ nodeId: 'node-worker-2' }],
    })
    expect(JSON.stringify(second)).not.toContain('committed after snapshot')
  })

  it('reads one exact Run without scanning unrelated transcript items into the result page', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'run-items.sqlite'))
    runtimes.push(runtime)
    const result = await executeQuery(runtime, {
      operation: 'items',
      sessionId: 'worker',
      runId: 'run-worker',
      limit: 10,
    })
    expect(result.outcome).toMatchObject({
      operation: 'items',
      items: [{ nodeId: 'node-worker-1', runId: 'run-worker' }],
    })
    expect(JSON.stringify(result)).not.toContain('second page')
  })
})
