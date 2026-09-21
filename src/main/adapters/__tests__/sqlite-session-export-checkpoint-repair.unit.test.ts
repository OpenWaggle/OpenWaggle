import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SESSION_EXPORT_PATH_CHECKPOINT_STRIDE } from '../../services/session-host-export-schema'
import { ensureCurrentExportPathCheckpoints } from '../sqlite-session-export-checkpoint-repair'
import { readExportNodes } from '../sqlite-session-export-node-reader'
import { makeSessionQueryRuntime as makeRuntime } from './sqlite-session-query-test-layer'

describe('SQLite Session export path checkpoint repair', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-repair-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('fails explicitly when a Session path-index state row is missing', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'missing-index-state.sqlite'))
    runtimes.push(runtime)

    const exit = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          DELETE FROM session_export_path_index_states WHERE session_id = ${'worker'}
        `
        return yield* readExportNodes(sql, {
          sessionId: 'worker',
          headNodeId: 'node-worker-1',
          tree: false,
          indexedBranchId: null,
          afterCreatedOrder: -1,
          throughCreatedOrder: 1,
          limit: 1,
        })
      }).pipe(Effect.exit),
    )

    expect(exit._tag).toBe('Failure')
  })

  it('commits bounded repair progress before interruption and resumes without rebuilding it', async () => {
    const filename = path.join(temporaryRoot, 'cancelled-repair.sqlite')
    const runtime = makeRuntime(filename)
    runtimes.push(runtime)
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`DROP TRIGGER session_node_search_insert`
        yield* sql`DROP TRIGGER session_export_path_checkpoint_node_insert`
        yield* sql`DROP TRIGGER session_nodes_mutation_revision_historical_insert`
        yield* sql`DROP TRIGGER session_export_path_index_historical_insert`
        yield* sql.unsafe(`
        WITH RECURSIVE sequence(value) AS (
          VALUES(1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 8192
        )
        INSERT INTO session_nodes (
          id, session_id, parent_id, kind, role, timestamp_ms,
          content_json, metadata_json, path_depth, created_order
        ) SELECT 'cancel-' || printf('%05d', value), 'worker',
          CASE WHEN value = 1 THEN 'node-worker-1'
            ELSE 'cancel-' || printf('%05d', value - 1) END,
          'message', 'assistant', value + 1, '{"text":"repair"}', '{}', value, value + 1
        FROM sequence
      `)
        yield* sql`
        UPDATE session_export_path_index_states SET topology_revision = 1
        WHERE session_id = ${'worker'}
      `
        const repair = yield* Effect.fork(ensureCurrentExportPathCheckpoints(sql, 'worker'))
        let progress = { building_created_order: -1, indexed_topology_revision: 0 }
        while (progress.building_created_order < 0) {
          const states = yield* sql<typeof progress>`
          SELECT building_created_order, indexed_topology_revision
          FROM session_export_path_index_states WHERE session_id = ${'worker'}
        `
          progress = states[0] ?? progress
          if (progress.building_created_order < 0) yield* Effect.yieldNow()
        }
        const interrupted = yield* Fiber.interrupt(repair)
        const checkpointsBefore = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM session_export_path_checkpoints
        WHERE session_id = ${'worker'} AND topology_revision = 1
      `
        yield* sql`
        CREATE TRIGGER prevent_repair_rewrite BEFORE INSERT ON session_export_path_checkpoints
        WHEN NEW.topology_revision = 1 AND EXISTS (
          SELECT 1 FROM session_export_path_checkpoints
          WHERE node_id = NEW.node_id AND topology_revision = NEW.topology_revision
        )
        BEGIN SELECT RAISE(ABORT, 'resumed checkpoint was rebuilt'); END
      `
        const page = yield* readExportNodes(sql, {
          sessionId: 'worker',
          headNodeId: 'cancel-08192',
          tree: false,
          indexedBranchId: null,
          afterCreatedOrder: -1,
          throughCreatedOrder: 8193,
          limit: 64,
        })
        const completed = yield* sql<{ readonly indexed_topology_revision: number }>`
        SELECT indexed_topology_revision FROM session_export_path_index_states
        WHERE session_id = ${'worker'}
      `
        return { progress, interrupted, checkpointsBefore, page, completed }
      }),
    )

    expect(result.progress.indexed_topology_revision).toBe(0)
    expect(result.progress.building_created_order).toBeGreaterThan(0)
    expect(result.progress.building_created_order).toBeLessThan(8193)
    expect(result.interrupted._tag).toBe('Failure')
    expect(result.checkpointsBefore[0]?.count).toBeGreaterThan(0)
    expect(result.checkpointsBefore[0]?.count).toBeLessThan(33)
    expect(result.completed[0]?.indexed_topology_revision).toBe(1)
    expect(result.page.rows[0]?.id).toBe('node-worker-1')
    expect(result.page.pathReadSteps).toBeLessThan(SESSION_EXPORT_PATH_CHECKPOINT_STRIDE * 4)
  })

  it('atomically rebuilds sparse checkpoints after a topology mutation', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'topology-repair.sqlite'))
    runtimes.push(runtime)
    const nodeCount = 4_096
    const replacementDepth = 777
    const sideNodeCount = 64
    const headNodeId = `node-repair-${nodeCount.toString().padStart(4, '0')}`

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe('DROP TRIGGER session_node_search_insert')
        yield* sql.unsafe(`
          WITH RECURSIVE sequence(value) AS (
            VALUES(1)
            UNION ALL
            SELECT value + 1 FROM sequence WHERE value < ${nodeCount}
          )
          INSERT INTO session_nodes (
            id, session_id, parent_id, kind, role, timestamp_ms,
            content_json, metadata_json, branch_hint_id, path_depth, created_order
          )
          SELECT
            'node-repair-' || printf('%04d', value),
            'worker',
            CASE
              WHEN value = 1 THEN 'node-worker-1'
              ELSE 'node-repair-' || printf('%04d', value - 1)
            END,
            'message', 'assistant', value + 2, '{"text":"repair"}', '{}',
            'worker:branch:repair', value, value + 1
          FROM sequence
        `)
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms,
            content_json, metadata_json, branch_hint_id, path_depth, created_order
          ) VALUES (
            ${'node-repair-alternative-root'}, ${'worker'}, ${'message'}, ${'assistant'},
            ${nodeCount + 2}, ${'{"text":"alternative root"}'}, ${'{}'},
            ${'worker:branch:repair'}, ${0}, ${nodeCount + 2}
          )
        `
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, parent_id, kind, role, timestamp_ms,
            content_json, metadata_json, branch_hint_id, path_depth, created_order
          ) VALUES (
            ${'node-repair-alternative'}, ${'worker'}, ${'node-repair-0776'},
            ${'message'}, ${'assistant'}, ${replacementDepth + 2}, ${'{"text":"alternative"}'},
            ${'{}'}, ${'worker:branch:repair'}, ${replacementDepth}, ${replacementDepth + 1}
          )
        `
        yield* sql.unsafe(`
          WITH RECURSIVE sequence(value) AS (
            VALUES(1)
            UNION ALL
            SELECT value + 1 FROM sequence WHERE value < ${sideNodeCount}
          )
          INSERT INTO session_nodes (
            id, session_id, parent_id, kind, role, timestamp_ms,
            content_json, metadata_json, branch_hint_id, path_depth, created_order
          )
          SELECT
            'node-repair-side-' || printf('%02d', value),
            'worker', 'node-worker-1', 'message', 'assistant', ${nodeCount + 2} + value,
            '{"text":"side"}', '{}', 'worker:branch:repair', 1, ${nodeCount + 2} + value
          FROM sequence
        `)
        yield* sql`
          UPDATE session_nodes
          SET parent_id = CASE
            WHEN id = ${'node-repair-0778'} THEN ${'node-repair-alternative'}
            ELSE ${'node-repair-alternative-root'}
          END
          WHERE id = ${'node-repair-0778'} OR id LIKE ${'node-repair-side-%'}
        `

        const dirtyStates = yield* sql<{
          readonly checkpoint_count: number
          readonly current_checkpoint_count: number
          readonly indexed_topology_revision: number
          readonly topology_revision: number
        }>`
          SELECT COUNT(checkpoint.node_id) AS checkpoint_count,
            COUNT(checkpoint.node_id) FILTER (
              WHERE checkpoint.topology_revision = state.topology_revision
            ) AS current_checkpoint_count,
            state.topology_revision, state.indexed_topology_revision
          FROM session_export_path_index_states AS state
          LEFT JOIN session_export_path_checkpoints AS checkpoint
            ON checkpoint.session_id = state.session_id
          WHERE state.session_id = ${'worker'}
          GROUP BY state.topology_revision, state.indexed_topology_revision
        `
        const changesBeforeFirstPage = yield* sql<{ readonly changes: number }>`
          SELECT total_changes() AS changes
        `
        const firstPage = yield* readExportNodes(sql, {
          sessionId: 'worker',
          headNodeId,
          tree: false,
          indexedBranchId: null,
          afterCreatedOrder: -1,
          throughCreatedOrder: nodeCount + 1,
          limit: 64,
        })
        const changesAfterFirstPage = yield* sql<{ readonly changes: number }>`
          SELECT total_changes() AS changes
        `
        const repairedPage = yield* readExportNodes(sql, {
          sessionId: 'worker',
          headNodeId,
          tree: false,
          indexedBranchId: null,
          afterCreatedOrder: replacementDepth,
          throughCreatedOrder: nodeCount + 1,
          limit: 64,
        })
        const changesAfterRepairedPage = yield* sql<{ readonly changes: number }>`
          SELECT total_changes() AS changes
        `
        const states = yield* sql<{
          readonly checkpoint_count: number
          readonly current_checkpoint_count: number
          readonly indexed_topology_revision: number
          readonly topology_revision: number
        }>`
          SELECT COUNT(checkpoint.node_id) AS checkpoint_count,
            COUNT(checkpoint.node_id) FILTER (
              WHERE checkpoint.topology_revision = state.topology_revision
            ) AS current_checkpoint_count,
            state.topology_revision, state.indexed_topology_revision
          FROM session_export_path_index_states AS state
          LEFT JOIN session_export_path_checkpoints AS checkpoint
            ON checkpoint.session_id = state.session_id
          WHERE state.session_id = ${'worker'}
          GROUP BY state.topology_revision, state.indexed_topology_revision
        `
        return {
          dirtyState: dirtyStates[0],
          firstPage,
          firstPageWrites:
            (changesAfterFirstPage[0]?.changes ?? 0) - (changesBeforeFirstPage[0]?.changes ?? 0),
          repairedPage,
          repairedPageWrites:
            (changesAfterRepairedPage[0]?.changes ?? 0) - (changesAfterFirstPage[0]?.changes ?? 0),
          state: states[0],
        }
      }),
    )

    const expectedCheckpointCount =
      Math.floor(nodeCount / SESSION_EXPORT_PATH_CHECKPOINT_STRIDE) + 2
    expect(result.dirtyState).toEqual({
      checkpoint_count: expectedCheckpointCount,
      current_checkpoint_count: 0,
      indexed_topology_revision: 0,
      topology_revision: sideNodeCount + 2,
    })
    expect(result.state).toEqual({
      checkpoint_count: expectedCheckpointCount,
      current_checkpoint_count: expectedCheckpointCount,
      indexed_topology_revision: sideNodeCount + 2,
      topology_revision: sideNodeCount + 2,
    })
    // Staged checkpoints and cleanup remain sparse; cursor commits add one write per source batch.
    expect(result.firstPageWrites).toBeLessThan(expectedCheckpointCount * 3)
    expect(result.repairedPageWrites).toBe(0)
    expect(result.firstPage.rows[0]?.id).toBe('node-worker-1')
    expect(result.firstPage.pathReadSteps).toBeLessThan(SESSION_EXPORT_PATH_CHECKPOINT_STRIDE * 4)
    expect(result.repairedPage.rows[0]?.id).toBe('node-repair-alternative')
    expect(result.repairedPage.rows.some((row) => row.id === 'node-repair-0777')).toBe(false)
    expect(result.repairedPage.pathReadSteps).toBeLessThan(
      SESSION_EXPORT_PATH_CHECKPOINT_STRIDE * 4,
    )
  })
})
