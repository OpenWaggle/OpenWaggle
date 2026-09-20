import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { mcpExportQuery } from './sqlite-session-export-query-test-support'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

function seedBranchNeedingRepair(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    for (const trigger of [
      'session_node_search_insert',
      'session_export_path_checkpoint_node_insert',
      'session_nodes_mutation_revision_historical_insert',
      'session_export_path_index_historical_insert',
    ]) {
      yield* sql.unsafe(`DROP TRIGGER ${trigger}`)
    }
    yield* sql.unsafe(`
      WITH RECURSIVE sequence(value) AS (
        VALUES(1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 8192
      )
      INSERT INTO session_nodes (
        id, session_id, parent_id, kind, role, timestamp_ms,
        content_json, metadata_json, path_depth, created_order
      ) SELECT 'repair-' || printf('%05d', value), 'worker',
        CASE WHEN value = 1 THEN 'node-worker-1'
          ELSE 'repair-' || printf('%05d', value - 1) END,
        'message', 'assistant', value + 1, '{"text":"repair"}', '{}', value, value + 1
      FROM sequence
    `)
    yield* sql`
      INSERT INTO session_branches (id, session_id, head_node_id)
      VALUES (${'worker:branch:repair'}, ${'worker'}, ${'repair-08192'})
    `
    yield* sql`
      UPDATE session_export_path_index_states SET topology_revision = ${1}
      WHERE session_id = ${'worker'}
    `
  })
}

interface RepairProgress {
  readonly building_created_order: number
  readonly indexed_topology_revision: number
}

describe('SQLite public Session export checkpoint repair', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeSessionQueryRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-public-export-repair-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('retains completed repair batches when the public export query is interrupted', async () => {
    const runtime = makeSessionQueryRuntime(path.join(temporaryRoot, 'repair.sqlite'))
    runtimes.push(runtime)
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const repository = yield* SessionQueryRepository
        yield* seedBranchNeedingRepair(sql)
        const completedBatch = yield* Deferred.make<RepairProgress>()
        const withTransaction = sql.withTransaction
        // Pause after a batch transaction returns. A surrounding export transaction would
        // turn that completed batch into an uncommitted savepoint and lose it on cancellation.
        const transaction = vi.spyOn(sql, 'withTransaction').mockImplementation((body) =>
          withTransaction(body).pipe(
            Effect.tap(() =>
              Effect.gen(function* () {
                const rows = yield* sql<RepairProgress>`
                  SELECT building_created_order, indexed_topology_revision
                  FROM session_export_path_index_states WHERE session_id = ${'worker'}
                `
                const progress = rows[0]
                if (!progress || progress.building_created_order < 0) return
                yield* Deferred.succeed(completedBatch, progress)
                yield* Effect.never
              }),
            ),
          ),
        )
        const request = {
          contractVersion: 2 as const,
          requestId: 'public-repair',
          query: mcpExportQuery({
            operation: 'export',
            sessionId: 'worker',
            branchId: 'worker:branch:repair',
            limit: 64,
          }),
        }
        const exporting = yield* Effect.fork(repository.execute({ request }))
        const observed = yield* Deferred.await(completedBatch).pipe(Effect.timeout('5 seconds'))
        const interrupted = yield* Fiber.interrupt(exporting)
        transaction.mockRestore()
        const persisted = yield* sql<RepairProgress>`
          SELECT building_created_order, indexed_topology_revision
          FROM session_export_path_index_states WHERE session_id = ${'worker'}
        `
        yield* sql`
          CREATE TRIGGER prevent_repair_rewrite BEFORE INSERT ON session_export_path_checkpoints
          WHEN NEW.topology_revision = 1 AND EXISTS (
            SELECT 1 FROM session_export_path_checkpoints
            WHERE node_id = NEW.node_id AND topology_revision = NEW.topology_revision
          )
          BEGIN SELECT RAISE(ABORT, 'resumed checkpoint was rebuilt'); END
        `
        const resumed = yield* repository.execute({ request })
        return { observed, interrupted, persisted, resumed }
      }),
    )

    expect(result.observed.building_created_order).toBeGreaterThan(0)
    expect(result.observed.building_created_order).toBeLessThan(8193)
    expect(result.observed.indexed_topology_revision).toBe(0)
    expect(result.interrupted._tag).toBe('Failure')
    expect(result.persisted[0]).toEqual(result.observed)
    expect(result.resumed.outcome).toMatchObject({
      operation: 'export',
      records: expect.arrayContaining([
        expect.objectContaining({ record: 'node', nodeId: 'node-worker-1' }),
      ]),
    })
  })
})
