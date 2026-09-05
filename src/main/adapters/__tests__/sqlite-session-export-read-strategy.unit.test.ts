import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionExportManifest } from '@shared/types/session-export'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { exportNodeReadStrategy } from '../sqlite-session-export-node-reader'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

describe('SQLite Session export node reads', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-node-read-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('uses the branch-hint cursor index for the active branch head only', () => {
    expect(
      exportNodeReadStrategy({
        tree: false,
        selectedBranchId: 'branch-active',
        activeBranchId: 'branch-active',
        selectedHeadNodeId: 'node-head',
        branchHeadNodeId: 'node-head',
      }),
    ).toBe('indexed-active-branch')
    expect(
      exportNodeReadStrategy({
        tree: false,
        selectedBranchId: 'branch-pinned',
        activeBranchId: 'branch-active',
        selectedHeadNodeId: 'node-head',
        branchHeadNodeId: 'node-head',
      }),
    ).toBe('recursive-branch')
    expect(
      exportNodeReadStrategy({
        tree: false,
        selectedBranchId: 'branch-active',
        activeBranchId: 'branch-active',
        selectedHeadNodeId: 'node-ancestor',
        branchHeadNodeId: 'node-head',
      }),
    ).toBe('recursive-branch')
    expect(
      exportNodeReadStrategy({
        tree: true,
        selectedBranchId: null,
        activeBranchId: 'branch-active',
        selectedHeadNodeId: null,
        branchHeadNodeId: null,
      }),
    ).toBe('tree')
  })

  it('keeps an ancestor snapshot head from exporting later active-branch descendants', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'export-ancestor-head.sqlite'))
    runtimes.push(runtime)

    const result = await executeQuery(runtime, {
      operation: 'export',
      sessionId: 'worker',
      limit: 10,
      branchScope: 'active-branch',
      snapshotHeadNodeId: 'node-worker-1',
    })

    if (result.outcome.operation !== 'export' || !('records' in result.outcome)) {
      throw new Error('Expected export outcome.')
    }
    expect(result.outcome.records.map((record) => record.nodeId)).toEqual(['node-worker-1'])
  })

  it('rejects supplied snapshot heads outside the selected existing branch', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'export-branch-binding.sqlite'))
    runtimes.push(runtime)
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
      }),
    )

    const missingBranch = await executeQuery(runtime, {
      operation: 'export',
      sessionId: 'worker',
      branchScope: 'active-branch',
      branchId: 'worker:branch:missing',
      snapshotHeadNodeId: 'node-worker-2',
      limit: 10,
    })
    const mismatchedHead = await executeQuery(runtime, {
      operation: 'export',
      sessionId: 'worker',
      branchScope: 'active-branch',
      branchId: 'worker:branch:main',
      snapshotHeadNodeId: 'node-worker-fork',
      limit: 10,
    })

    expect(missingBranch.outcome).toMatchObject({ error: { code: 'branch_not_found' } })
    expect(mismatchedHead.outcome).toMatchObject({ error: { code: 'branch_not_found' } })
  })

  it('materializes a long historical branch once across every export page', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'export-materialized-path.sqlite'))
    runtimes.push(runtime)
    const operationId = 'export-historical-branch'
    const historicalBranchId = 'worker:branch:history'
    const historicalNodeCount = 1_200

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
            'node-worker-history-' || printf('%04d', value),
            'worker',
            CASE
              WHEN value = 1 THEN 'node-worker-1'
              ELSE 'node-worker-history-' || printf('%04d', value - 1)
            END,
            'message', 'assistant', value + 2, '{"text":"historical"}', '{}',
            '${historicalBranchId}', value + 1
          FROM sequence
        `)
        yield* sql`
          INSERT INTO session_branches (id, session_id, head_node_id)
          VALUES (
            ${historicalBranchId}, ${'worker'},
            ${`node-worker-history-${historicalNodeCount.toString().padStart(4, '0')}`}
          )
        `
        yield* sql`
          INSERT INTO session_export_operations (
            id, caller_id, session_id, idempotency_key, request_json, format,
            destination_path, temporary_path, overwrite_existing, branch_scope, branch_id,
            include_queue_bodies, resources_json, status, created_at, updated_at
          ) VALUES (
            ${operationId}, ${'cli'}, ${'worker'}, ${'historical-once'}, ${'{}'}, ${'jsonl'},
            ${'/tmp/history.jsonl'}, ${'/tmp/history.jsonl.tmp'}, ${0}, ${'active-branch'},
            ${historicalBranchId}, ${0}, ${'[]'}, ${'running'}, ${1}, ${1}
          )
        `
        yield* sql.unsafe(`
          CREATE TABLE export_path_insert_probe (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            attempts INTEGER NOT NULL
          )
        `)
        yield* sql`INSERT INTO export_path_insert_probe (singleton, attempts) VALUES (${1}, ${0})`
        yield* sql.unsafe(`
          CREATE TRIGGER count_export_path_insert
          BEFORE INSERT ON session_export_selected_path_nodes
          BEGIN
            UPDATE export_path_insert_probe SET attempts = attempts + 1 WHERE singleton = 1;
          END
        `)
      }),
    )

    let manifest: SessionExportManifest | undefined
    let afterCreatedOrder: number | undefined
    const exportedNodeIds: string[] = []
    let pageCount = 0
    while (true) {
      const response = await runtime.runPromise(
        Effect.gen(function* () {
          const repository = yield* SessionQueryRepository
          return yield* repository.execute({
            exportMaterializationOperationId: operationId,
            request: {
              contractVersion: 2,
              requestId: `${operationId}:${afterCreatedOrder ?? 'first'}`,
              query: {
                operation: 'export',
                sessionId: 'worker',
                branchScope: 'active-branch',
                branchId: historicalBranchId,
                limit: 137,
                ...(afterCreatedOrder === undefined ? {} : { afterCreatedOrder }),
                ...(manifest ? { snapshotManifest: manifest } : {}),
              },
            },
          })
        }),
      )
      if (response.outcome.operation !== 'export' || !('records' in response.outcome)) {
        throw new Error('Expected export outcome.')
      }
      manifest ??= response.outcome.manifest
      exportedNodeIds.push(...response.outcome.records.map((record) => record.nodeId))
      pageCount += 1
      if (response.outcome.nextCreatedOrder === undefined) break
      afterCreatedOrder = response.outcome.nextCreatedOrder
      if (pageCount === 1) {
        await runtime.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            yield* sql`
              UPDATE session_export_operations SET status = ${'queued'} WHERE id = ${operationId}
            `
            yield* sql`
              UPDATE session_export_operations SET status = ${'running'} WHERE id = ${operationId}
            `
          }),
        )
      }
    }

    const materialization = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const headers = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_export_selected_paths
          WHERE export_operation_id = ${operationId}
        `
        const nodes = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_export_selected_path_nodes
          WHERE export_operation_id = ${operationId}
        `
        const attempts = yield* sql<{ readonly attempts: number }>`
          SELECT attempts FROM export_path_insert_probe WHERE singleton = ${1}
        `
        return {
          headers: headers[0]?.count,
          nodes: nodes[0]?.count,
          attempts: attempts[0]?.attempts,
        }
      }),
    )

    expect(pageCount).toBeGreaterThan(5)
    expect(exportedNodeIds).toHaveLength(historicalNodeCount + 1)
    expect(new Set(exportedNodeIds).size).toBe(exportedNodeIds.length)
    expect(exportedNodeIds[0]).toBe('node-worker-1')
    expect(exportedNodeIds.at(-1)).toBe('node-worker-history-1200')
    expect(materialization).toEqual({
      headers: 1,
      nodes: historicalNodeCount + 1,
      attempts: historicalNodeCount + 1,
    })

    const retainedAfterCompletion = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_export_operations
          SET status = ${'completed'}, completed_at = ${2}, updated_at = ${2}
          WHERE id = ${operationId}
        `
        const headers = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_export_selected_paths
          WHERE export_operation_id = ${operationId}
        `
        const nodes = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_export_selected_path_nodes
          WHERE export_operation_id = ${operationId}
        `
        return { headers: headers[0]?.count, nodes: nodes[0]?.count }
      }),
    )
    expect(retainedAfterCompletion).toEqual({ headers: 0, nodes: 0 })
  })
})
