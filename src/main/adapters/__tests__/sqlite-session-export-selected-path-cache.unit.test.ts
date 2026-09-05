import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionExportManifest } from '@shared/types/session-export'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
            content_json, metadata_json, branch_hint_id, created_order
          )
          SELECT
            'node-stateless-' || printf('%03d', value),
            'worker',
            CASE
              WHEN value = 1 THEN 'node-worker-1'
              ELSE 'node-stateless-' || printf('%03d', value - 1)
            END,
            'message', 'assistant', value + 2, '{"text":"historical"}', '{}',
            '${historicalBranchId}', value + 1
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
})
