import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionOrchestrationUpdateRepository } from '../../ports/session-orchestration-update-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-target-schema'
import { SqliteSessionOrchestrationUpdateRepositoryLive } from '../sqlite-session-orchestration-update-repository'

let temporaryRoot = ''

function makeLayer(filename: string) {
  const sqlite = SqliteClient.layer({ filename, prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
      for (const statement of SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
      yield* sql`INSERT INTO sessions (id) VALUES (${'queen'}), (${'worker'})`
      yield* sql`
        INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
        VALUES (${'run-worker'}, ${'worker'}, ${'completed'}, ${1}, ${1}),
          (${'run-queen'}, ${'queen'}, ${'active'}, ${2}, ${2})
      `
      yield* sql`
        INSERT INTO delegation_contracts (
          id, parent_session_id, child_session_id, state,
          current_specification_revision, created_at, updated_at
        ) VALUES (${'delegation'}, ${'queen'}, ${'worker'}, ${'ready_for_review'}, ${1}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO session_orchestration_updates (
          id, parent_session_id, worker_session_id, delegation_id, source_run_id,
          state, summary, status, created_at
        ) VALUES (
          ${'update-1'}, ${'queen'}, ${'worker'}, ${'delegation'}, ${'run-worker'},
          ${'ready_for_review'}, ${'Worker completed the migration.'}, ${'pending'}, ${3}
        )
      `
      yield* sql`
        INSERT INTO delegation_specification_updates (
          id, delegation_id, parent_session_id, worker_session_id,
          specification_revision, specification_json, reason, status, created_at
        ) VALUES (
          ${'specification-update-1'}, ${'delegation'}, ${'queen'}, ${'worker'}, ${2},
          ${'{"objective":"Expanded objective","deliverables":[],"acceptanceCriteria":[],"dependencies":[],"resourceReferences":[]}'},
          ${'Scope expanded.'}, ${'pending'}, ${4}
        )
      `
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.mergeAll(
    sqlite,
    schema,
    SqliteSessionOrchestrationUpdateRepositoryLive.pipe(Layer.provide(sqlite)),
  )
}

describe('SQLite Session orchestration update repository', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-orchestration-update-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('lists pending parent updates and marks their exact context items delivered once', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionOrchestrationUpdateRepository
        const pending = yield* repository.listPending({ parentSessionId: 'queen' })
        const pendingSpecifications = yield* repository.listPendingSpecifications({
          workerSessionId: 'worker',
        })
        yield* repository.markDelivered({
          updateIds: ['update-1'],
          parentSessionId: 'queen',
          runId: 'run-queen',
          itemIds: ['orchestration:run-queen:update-1'],
          deliveredAt: 4,
        })
        yield* repository.markDelivered({
          updateIds: ['update-1'],
          parentSessionId: 'queen',
          runId: 'run-queen',
          itemIds: ['orchestration:run-queen:update-1'],
          deliveredAt: 5,
        })
        yield* repository.markSpecificationsDelivered({
          updateIds: ['specification-update-1'],
          workerSessionId: 'worker',
          runId: 'run-worker',
          itemIds: ['delegation-specification:run-worker:specification-update-1'],
          deliveredAt: 5,
        })
        const after = yield* repository.listPending({ parentSessionId: 'queen' })
        const afterSpecifications = yield* repository.listPendingSpecifications({
          workerSessionId: 'worker',
        })
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          readonly status: string
          readonly delivered_run_id: string
          readonly delivered_item_id: string
          readonly delivered_at: number
        }>`SELECT status, delivered_run_id, delivered_item_id, delivered_at
          FROM session_orchestration_updates WHERE id = ${'update-1'}`
        const specificationRows = yield* sql<{
          readonly status: string
          readonly delivered_item_id: string
        }>`
          SELECT status, delivered_item_id FROM delegation_specification_updates
          WHERE id = ${'specification-update-1'}
        `
        return {
          pending,
          pendingSpecifications,
          after,
          afterSpecifications,
          row: rows[0],
          specificationRow: specificationRows[0],
        }
      }).pipe(Effect.provide(makeLayer(path.join(temporaryRoot, 'updates.sqlite')))),
    )

    expect(result).toEqual({
      pending: [
        {
          updateId: 'update-1',
          delegationId: 'delegation',
          workerSessionId: 'worker',
          sourceRunId: 'run-worker',
          state: 'ready_for_review',
          summary: 'Worker completed the migration.',
          createdAt: 3,
        },
      ],
      after: [],
      pendingSpecifications: [
        {
          updateId: 'specification-update-1',
          delegationId: 'delegation',
          parentSessionId: 'queen',
          workerSessionId: 'worker',
          specificationRevision: 2,
          specification: expect.objectContaining({ objective: 'Expanded objective' }),
          reason: 'Scope expanded.',
          createdAt: 4,
        },
      ],
      afterSpecifications: [],
      row: {
        status: 'delivered',
        delivered_run_id: 'run-queen',
        delivered_item_id: 'orchestration:run-queen:update-1',
        delivered_at: 4,
      },
      specificationRow: {
        status: 'delivered',
        delivered_item_id: 'delegation-specification:run-worker:specification-update-1',
      },
    })
  })
})
