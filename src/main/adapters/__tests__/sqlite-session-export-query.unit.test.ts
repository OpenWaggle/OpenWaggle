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

describe('SQLite Session export query', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-export-query-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('fixes a paginated snapshot and declares omitted queue bodies', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'export.sqlite'))
    runtimes.push(runtime)
    const first = await executeQuery(runtime, {
      operation: 'export',
      sessionId: 'worker',
      limit: 1,
      branchScope: 'active-branch',
    })
    if (first.outcome.operation !== 'export' || !('manifest' in first.outcome)) {
      throw new Error('Expected export outcome.')
    }
    const second = await executeQuery(runtime, {
      operation: 'export',
      sessionId: 'worker',
      limit: 1,
      branchScope: 'active-branch',
      afterCreatedOrder: first.outcome.nextCreatedOrder,
      throughCreatedOrder: first.outcome.manifest.snapshot.nodeHighWaterMark,
      snapshotStateRevision: first.outcome.manifest.snapshot.stateRevision,
      capturedAt: first.outcome.manifest.snapshot.capturedAt,
    })

    expect(first.outcome).toMatchObject({
      manifest: {
        schemaVersion: 1,
        selectedBranchId: 'worker:branch:main',
        snapshot: { nodeHighWaterMark: 1 },
        queue: { pendingCount: 1, bodyScope: 'omitted-by-choice', omittedBodyCount: 1 },
      },
      records: [{ record: 'node', nodeId: 'node-worker-1', runId: 'run-worker' }],
      nextCreatedOrder: 0,
    })
    expect(second.outcome).toMatchObject({
      records: [{ nodeId: 'node-worker-2', parentNodeId: 'node-worker-1' }],
    })
    expect(JSON.stringify(first.outcome)).not.toContain('"text":"next"')
  })

  it('lists and reads durable export operation progress', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'operations.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_export_operations (
            id, caller_id, session_id, idempotency_key, request_json, format,
            destination_path, temporary_path, overwrite_existing, branch_scope,
            include_queue_bodies, resources_json, status, records_written,
            resources_written, bytes_written, created_at, updated_at
          ) VALUES (
            ${'export-1'}, ${'cli'}, ${'worker'}, ${'key-1'}, ${'{}'}, ${'jsonl'},
            ${'/tmp/worker.jsonl'}, ${'/tmp/worker.jsonl.tmp'}, ${0}, ${'tree'},
            ${0}, ${'[]'}, ${'running'}, ${2}, ${0}, ${512}, ${10}, ${20}
          )
        `
      }),
    )

    const listed = await executeQuery(runtime, {
      operation: 'exports-list',
      sessionId: 'worker',
      limit: 10,
      statuses: ['running'],
    })
    const read = await executeQuery(runtime, {
      operation: 'exports-read',
      sessionId: 'worker',
      exportOperationId: 'export-1',
    })

    expect(listed.outcome).toMatchObject({
      operation: 'exports-list',
      exports: [
        {
          exportOperationId: 'export-1',
          status: 'running',
          progress: { recordsWritten: 2, bytesWritten: 512 },
        },
      ],
    })
    expect(read.outcome).toMatchObject({
      operation: 'exports-read',
      export: { exportOperationId: 'export-1', destinationPath: '/tmp/worker.jsonl' },
    })
  })
})
