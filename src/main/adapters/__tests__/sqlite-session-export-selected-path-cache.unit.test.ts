import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionExportManifest } from '@shared/types/session-export'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SESSION_EXPORT_PATH_CHECKPOINT_STRIDE } from '../../services/session-host-export-schema'
import { readExportNodes } from '../sqlite-session-export-node-reader'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

describe('SQLite stateless Session export selected-path cache', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-path-cache-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('reuses one selected path across a long stateless export without a protocol cache key', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'stateless-export.sqlite'))
    runtimes.push(runtime)
    const historicalBranchId = 'worker:branch:stateless-history'
    const historicalNodeCount = 30
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          WITH RECURSIVE sequence(value) AS (
            VALUES(1)
            UNION ALL
            SELECT value + 1 FROM sequence WHERE value < ${historicalNodeCount}
          )
          INSERT INTO session_nodes (
            id, session_id, parent_id, kind, role, timestamp_ms,
            content_json, metadata_json, branch_hint_id, path_depth, created_order
          )
          SELECT
            'node-stateless-' || printf('%03d', value),
            'worker',
            CASE
              WHEN value = 1 THEN 'node-worker-1'
              ELSE 'node-stateless-' || printf('%03d', value - 1)
            END,
            'message', 'assistant', value + 2, '{"text":"historical"}', '{}',
            '${historicalBranchId}', value, value + 1
          FROM sequence
        `)
        yield* sql`
          INSERT INTO session_branches (id, session_id, head_node_id)
          VALUES (${historicalBranchId}, ${'worker'}, ${'node-stateless-030'})
        `
      }),
    )

    let manifest: SessionExportManifest | undefined
    let afterCreatedOrder: number | undefined
    const nodeIds: string[] = []
    let pages = 0
    while (true) {
      const response = await executeQuery(runtime, {
        operation: 'export',
        sessionId: 'worker',
        branchScope: 'active-branch',
        branchId: historicalBranchId,
        limit: 4,
        ...(afterCreatedOrder === undefined ? {} : { afterCreatedOrder }),
        ...(manifest ? { snapshotManifest: manifest } : {}),
      })
      if (response.outcome.operation !== 'export' || !('records' in response.outcome)) {
        throw new Error('Expected export outcome.')
      }
      manifest ??= response.outcome.manifest
      nodeIds.push(...response.outcome.records.map((record) => record.nodeId))
      pages += 1
      if (response.outcome.nextCreatedOrder === undefined) break
      afterCreatedOrder = response.outcome.nextCreatedOrder
      if (pages === 1) {
        await runtime.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            yield* sql`DELETE FROM session_branches WHERE id = ${historicalBranchId}`
          }),
        )
      }
    }

    expect(pages).toBeGreaterThan(5)
    expect(nodeIds).toHaveLength(historicalNodeCount + 1)
    expect(new Set(nodeIds).size).toBe(nodeIds.length)
    expect(nodeIds.at(-1)).toBe('node-stateless-030')
  })

  it('bounds first and continuation page work above the former 250,000-node cache ceiling', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'stateless-large-export.sqlite'))
    runtimes.push(runtime)
    const historicalBranchId = 'worker:branch:stateless-large'
    const historicalNodeCount = 250_128
    const pageLimit = 128
    const headNodeId = `node-stateless-large-${historicalNodeCount.toString().padStart(6, '0')}`
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe('DROP TRIGGER session_node_search_insert')
        yield* sql.unsafe(`
            CREATE INDEX idx_large_export_fixture_created_order
            ON session_nodes (session_id, created_order)
          `)
        yield* sql.unsafe(`
            WITH RECURSIVE sequence(value) AS (
              VALUES(1)
              UNION ALL
              SELECT value + 1 FROM sequence WHERE value < ${historicalNodeCount}
            )
            INSERT INTO session_nodes (
              id, session_id, parent_id, kind, role, timestamp_ms,
              content_json, metadata_json, branch_hint_id, path_depth, created_order
            )
            SELECT
              'node-stateless-large-' || printf('%06d', value),
              'worker',
              CASE
                WHEN value = 1 THEN 'node-worker-1'
                ELSE 'node-stateless-large-' || printf('%06d', value - 1)
              END,
              'message', 'assistant', value + 2, '{"text":"large"}', '{}',
              '${historicalBranchId}', value, value + 1
            FROM sequence
          `)
        yield* sql`
            INSERT INTO session_branches (id, session_id, head_node_id)
            VALUES (${historicalBranchId}, ${'worker'}, ${headNodeId})
          `
      }),
    )

    const readPage = (afterCreatedOrder: number) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const changesBefore = (yield* sql<{
            readonly changes: number
          }>`SELECT total_changes() AS changes`)[0]?.changes
          const page = yield* readExportNodes(sql, {
            sessionId: 'worker',
            headNodeId,
            tree: false,
            indexedBranchId: null,
            afterCreatedOrder,
            throughCreatedOrder: historicalNodeCount + 1,
            limit: pageLimit,
          })
          const changesAfter = (yield* sql<{
            readonly changes: number
          }>`SELECT total_changes() AS changes`)[0]?.changes
          return { page, writes: (changesAfter ?? 0) - (changesBefore ?? 0) }
        }),
      )

    const first = await readPage(-1)
    const firstCursor = first.page.rows.at(-1)?.created_order
    if (firstCursor === undefined) throw new Error('Expected a first export page.')
    const second = await readPage(firstCursor)
    const tree = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* readExportNodes(sql, {
          sessionId: 'worker',
          headNodeId: null,
          tree: true,
          indexedBranchId: null,
          afterCreatedOrder: historicalNodeCount - pageLimit,
          throughCreatedOrder: historicalNodeCount + 1,
          limit: pageLimit,
        })
      }),
    )
    const publicFirst = await executeQuery(runtime, {
      operation: 'export',
      sessionId: 'worker',
      branchScope: 'active-branch',
      branchId: historicalBranchId,
      limit: pageLimit,
    })
    if (publicFirst.outcome.operation !== 'export' || !('records' in publicFirst.outcome)) {
      throw new Error('Expected a public first export page.')
    }
    const publicCursor = publicFirst.outcome.nextCreatedOrder
    if (publicCursor === undefined) throw new Error('Expected a public continuation cursor.')
    const publicSecond = await executeQuery(runtime, {
      operation: 'export',
      sessionId: 'worker',
      branchScope: 'active-branch',
      branchId: historicalBranchId,
      limit: pageLimit,
      afterCreatedOrder: publicCursor,
      snapshotManifest: publicFirst.outcome.manifest,
    })
    if (publicSecond.outcome.operation !== 'export' || !('records' in publicSecond.outcome)) {
      throw new Error('Expected a public continuation export page.')
    }
    const checkpointCount = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count
            FROM session_export_path_checkpoints
            WHERE session_id = ${'worker'}
          `
        return rows[0]?.count ?? 0
      }),
    )

    expect(first.page.rows).toHaveLength(pageLimit)
    expect(second.page.rows).toHaveLength(pageLimit)
    expect(first.page.rows[0]?.id).toBe('node-worker-1')
    expect(second.page.rows[0]?.created_order).toBeGreaterThan(firstCursor)
    expect(tree.rows).toHaveLength(pageLimit)
    expect(tree.pathReadSteps).toBe(0)
    expect(publicFirst.outcome.records).toHaveLength(pageLimit)
    expect(publicSecond.outcome.records).toHaveLength(pageLimit)
    expect(first.page.pathReadSteps).toBeLessThan(SESSION_EXPORT_PATH_CHECKPOINT_STRIDE * 4)
    expect(second.page.pathReadSteps).toBeLessThan(SESSION_EXPORT_PATH_CHECKPOINT_STRIDE * 4)
    expect(first.writes).toBe(0)
    expect(second.writes).toBe(0)
    expect(checkpointCount).toBe(
      Math.floor(historicalNodeCount / SESSION_EXPORT_PATH_CHECKPOINT_STRIDE) + 1,
    )
  }, 30_000)
})
