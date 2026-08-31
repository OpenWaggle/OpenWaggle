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
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_branches SET head_node_id = ${'node-worker-1'}
          WHERE id = ${'worker:branch:main'}
        `
        yield* sql`
          UPDATE session_control_states
          SET queue_state = ${'paused'}, queue_revision = queue_revision + 1,
            active_run_id = ${null}
          WHERE session_id = ${'worker'}
        `
        yield* sql`
          UPDATE session_follow_ups
          SET delivery_state = ${'needs_attention'}, attention_reason = ${'authority_changed'}
          WHERE session_id = ${'worker'}
        `
      }),
    )
    const second = await executeQuery(runtime, {
      operation: 'export',
      sessionId: 'worker',
      limit: 1,
      branchScope: 'active-branch',
      afterCreatedOrder: first.outcome.nextCreatedOrder,
      throughCreatedOrder: first.outcome.manifest.snapshot.nodeHighWaterMark,
      snapshotStateRevision: first.outcome.manifest.snapshot.stateRevision,
      snapshotHeadNodeId: first.outcome.manifest.snapshot.selectedHeadNodeId,
      capturedAt: first.outcome.manifest.snapshot.capturedAt,
      snapshotManifest: first.outcome.manifest,
    })

    expect(first.outcome).toMatchObject({
      manifest: {
        schemaVersion: 1,
        selectedBranchId: 'worker:branch:main',
        snapshot: { nodeHighWaterMark: 1, selectedHeadNodeId: 'node-worker-2' },
        queue: { pendingCount: 1, bodyScope: 'omitted-by-choice', omittedBodyCount: 1 },
      },
      records: [{ record: 'node', nodeId: 'node-worker-1', runId: 'run-worker' }],
      nextCreatedOrder: 0,
    })
    expect(second.outcome).toMatchObject({
      manifest: first.outcome.manifest,
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

  it('byte-pages export operation summaries before large manifests can exceed the Host limit', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'large-operation-list.sqlite'))
    runtimes.push(runtime)
    const largeText = 'x'.repeat(20 * 1024 * 1024)
    const manifest = JSON.stringify({
      schemaVersion: 1,
      sessionId: 'worker',
      title: 'Large export',
      branchScope: 'tree',
      activeBranchId: 'worker:branch:main',
      selectedBranchId: null,
      snapshot: {
        nodeHighWaterMark: 1,
        stateRevision: 0,
        queueRevision: 0,
        capturedAt: 1,
      },
      activeRunId: null,
      activeTurnIncomplete: false,
      queue: {
        state: 'paused',
        pendingCount: 1,
        bodyScope: 'included',
        omittedBodyCount: 0,
        items: [
          {
            followUpId: 'follow-up-large',
            position: 0,
            createdAt: 1,
            deliveryState: 'pending',
            intent: { text: largeText },
          },
        ],
      },
    })
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        for (let index = 0; index < 3; index += 1) {
          yield* sql`
            INSERT INTO session_export_operations (
              id, caller_id, session_id, idempotency_key, request_json, format,
              destination_path, temporary_path, overwrite_existing, branch_scope,
              include_queue_bodies, resources_json, status, manifest_json,
              snapshot_high_water_mark, snapshot_state_revision, snapshot_captured_at,
              records_written, resources_written, bytes_written, created_at, updated_at,
              completed_at
            ) VALUES (
              ${`export-large-${index}`}, ${'cli'}, ${'worker'}, ${`key-large-${index}`},
              ${'{}'}, ${'jsonl'}, ${`/tmp/large-${index}.jsonl`},
              ${`/tmp/large-${index}.jsonl.tmp`}, ${0}, ${'tree'}, ${1}, ${'[]'},
              ${'completed'}, ${manifest}, ${1}, ${0}, ${1}, ${1}, ${0}, ${1},
              ${index + 1}, ${index + 1}, ${index + 1}
            )
          `
        }
      }),
    )

    const first = await executeQuery(runtime, {
      operation: 'exports-list',
      sessionId: 'worker',
      limit: 200,
    })
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(
      SESSION_QUERY_MAX_RESPONSE_BYTES,
    )
    if (first.outcome.operation !== 'exports-list' || !('exports' in first.outcome)) {
      throw new Error('Expected export operation list.')
    }
    expect(first.outcome.exports).toHaveLength(1)
    expect(first.outcome.nextCursor).toBeTypeOf('string')
    const second = await executeQuery(runtime, {
      operation: 'exports-list',
      sessionId: 'worker',
      limit: 200,
      cursor: first.outcome.nextCursor,
    })
    if (second.outcome.operation !== 'exports-list' || !('exports' in second.outcome)) {
      throw new Error('Expected export operation continuation.')
    }
    expect(second.outcome.exports).toHaveLength(1)
    expect(second.outcome.nextCursor).toBeTypeOf('string')
  })
})
