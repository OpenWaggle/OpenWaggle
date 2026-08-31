import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_QUERY_MAX_RESPONSE_BYTES } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

async function collectLargeTranscriptPages(
  runtime: ReturnType<typeof makeRuntime>,
  operation: 'export' | 'items',
) {
  const seen = new Set<string>()
  let afterCreatedOrder: number | undefined
  let throughCreatedOrder: number | undefined
  do {
    const pageCursor = {
      ...(afterCreatedOrder === undefined ? {} : { afterCreatedOrder }),
      ...(throughCreatedOrder === undefined ? {} : { throughCreatedOrder }),
    }
    const result = await executeQuery(
      runtime,
      operation === 'items'
        ? { operation, sessionId: 'worker', limit: 500, branchScope: 'tree', ...pageCursor }
        : { operation, sessionId: 'worker', limit: 500, branchScope: 'tree', ...pageCursor },
    )
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
      SESSION_QUERY_MAX_RESPONSE_BYTES,
    )
    if (result.outcome.operation === 'items' && !('error' in result.outcome)) {
      for (const record of result.outcome.items) seen.add(record.nodeId)
      throughCreatedOrder ??= result.outcome.highWaterMark
      afterCreatedOrder = result.outcome.nextCreatedOrder
      continue
    }
    if (result.outcome.operation === 'export' && !('error' in result.outcome)) {
      for (const record of result.outcome.records) seen.add(record.nodeId)
      throughCreatedOrder ??= result.outcome.manifest.snapshot.nodeHighWaterMark
      afterCreatedOrder = result.outcome.nextCreatedOrder
      continue
    }
    throw new Error(`Expected ${operation} page.`)
  } while (afterCreatedOrder !== undefined)
  return seen
}

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

  it('pins the selected branch head across pages and exposes tree traversal explicitly', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'branch-snapshot-read.sqlite'))
    runtimes.push(runtime)
    const first = await executeQuery(runtime, {
      operation: 'items',
      sessionId: 'worker',
      branchScope: 'active-branch',
      limit: 1,
    })
    if (first.outcome.operation !== 'items' || !('items' in first.outcome)) {
      throw new Error('Expected transcript items.')
    }
    expect(first.outcome).toMatchObject({
      selectedBranchId: 'worker:branch:main',
      snapshotHeadNodeId: 'node-worker-2',
      items: [{ nodeId: 'node-worker-1', branchHintId: 'worker:branch:main' }],
    })

    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, parent_id, kind, role, timestamp_ms,
            content_json, metadata_json, branch_hint_id, created_order
          ) VALUES (
            ${'node-worker-fork'}, ${'worker'}, ${'node-worker-1'}, ${'message'}, ${'assistant'},
            ${3}, ${'{"text":"fork-only"}'}, ${'{}'}, ${'worker:branch:fork'}, ${2}
          )
        `
        yield* sql`
          INSERT INTO session_branches (id, session_id, head_node_id)
          VALUES (${'worker:branch:fork'}, ${'worker'}, ${'node-worker-fork'})
        `
        yield* sql`
          UPDATE sessions SET last_active_branch_id = ${'worker:branch:fork'}
          WHERE id = ${'worker'}
        `
      }),
    )

    const second = await executeQuery(runtime, {
      operation: 'items',
      sessionId: 'worker',
      branchScope: 'active-branch',
      branchId: first.outcome.selectedBranchId ?? undefined,
      snapshotHeadNodeId: first.outcome.snapshotHeadNodeId ?? undefined,
      throughCreatedOrder: first.outcome.highWaterMark,
      afterCreatedOrder: first.outcome.nextCreatedOrder,
      limit: 10,
    })
    expect(second.outcome).toMatchObject({
      operation: 'items',
      selectedBranchId: 'worker:branch:main',
      snapshotHeadNodeId: 'node-worker-2',
      items: [{ nodeId: 'node-worker-2' }],
    })
    expect(JSON.stringify(second)).not.toContain('fork-only')

    const missingBranch = await executeQuery(runtime, {
      operation: 'items',
      sessionId: 'worker',
      branchScope: 'active-branch',
      branchId: 'worker:branch:missing',
      snapshotHeadNodeId: 'node-worker-2',
      limit: 10,
    })
    const mismatchedHead = await executeQuery(runtime, {
      operation: 'items',
      sessionId: 'worker',
      branchScope: 'active-branch',
      branchId: 'worker:branch:main',
      snapshotHeadNodeId: 'node-worker-fork',
      limit: 10,
    })
    expect(missingBranch.outcome).toMatchObject({ error: { code: 'branch_not_found' } })
    expect(mismatchedHead.outcome).toMatchObject({ error: { code: 'branch_not_found' } })

    const tree = await executeQuery(runtime, {
      operation: 'items',
      sessionId: 'worker',
      branchScope: 'tree',
      limit: 10,
    })
    expect(tree.outcome).toMatchObject({
      operation: 'items',
      branchScope: 'tree',
      selectedBranchId: null,
      snapshotHeadNodeId: null,
      items: [
        { nodeId: 'node-worker-1' },
        { nodeId: 'node-worker-2' },
        { nodeId: 'node-worker-fork', branchHintId: 'worker:branch:fork' },
      ],
    })
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

  it('byte-pages transcripts and exports whose aggregate content exceeds the Host message limit', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'large-pages.sqlite'))
    runtimes.push(runtime)
    const largeText = 'x'.repeat(10 * 1024 * 1024)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        for (let index = 2; index < 9; index += 1) {
          yield* sql`
            INSERT INTO session_nodes (
              id, session_id, parent_id, kind, role, timestamp_ms,
              content_json, metadata_json, branch_hint_id, created_order
            ) VALUES (
              ${`node-large-${index}`}, ${'worker'}, ${null}, ${'message'}, ${'assistant'},
              ${index}, ${JSON.stringify({ text: largeText })}, ${'{}'},
              ${'worker:branch:large'}, ${index}
            )
          `
        }
      }),
    )

    for (const operation of ['items', 'export'] as const) {
      const seen = await collectLargeTranscriptPages(runtime, operation)
      expect(seen.size).toBe(9)
    }
  })

  it('rejects one oversized transcript record before hydrating its body', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'oversized-record.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, created_order
          ) VALUES (
            'node-oversized', 'worker', 'message', 'assistant', 3,
            json_object('text', replace(hex(zeroblob(51380224)), '00', 'x')),
            '{}', 'worker:branch:oversized', 2
          )
        `)
      }),
    )

    const result = await executeQuery(runtime, {
      operation: 'items',
      sessionId: 'worker',
      branchScope: 'tree',
      afterCreatedOrder: 1,
      limit: 500,
    })
    expect(result.outcome).toEqual({
      operation: 'items',
      error: {
        code: 'record_too_large',
        message: 'A transcript item exceeds the maximum Session query response size.',
      },
    })
  })
})
