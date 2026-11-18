import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { runAppDatabaseMigrations } from '../../services/database-service'
import { readSessionHostUpgradeBlockers } from '../session-host-upgrade-blockers'

const migratedHostDatabase = SqliteClient.layer({ filename: ':memory:' })

function runOnHostConnection<A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* runAppDatabaseMigrations
      // Blockers reference Sessions, Runs and Workspaces; only the blocker rows matter here.
      yield* (yield* SqlClient.SqlClient).unsafe('PRAGMA foreign_keys = OFF')
      return yield* effect
    }).pipe(Effect.provide(migratedHostDatabase)),
  )
}

function insertExport(sql: SqlClient.SqlClient, id: string, status: string, createdAt: number) {
  const completedAt = ['completed', 'failed', 'cancelled'].includes(status) ? createdAt : null
  return sql`INSERT INTO session_export_operations (
      id, caller_id, session_id, idempotency_key, request_json, format, destination_path,
      temporary_path, overwrite_existing, branch_scope, include_queue_bodies, resources_json,
      status, created_at, updated_at, completed_at
    ) VALUES (
      ${id}, 'caller', ${`session-${id}`}, ${id}, '{}', 'jsonl', ${`/exports/${id}.jsonl`},
      ${`/exports/${id}.partial`}, 0, 'tree', 0, '[]', ${status}, ${createdAt}, ${createdAt}, ${completedAt}
    )`
}

const seedEveryBlockerKind = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO session_control_states
      (session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at)
    VALUES ('session-b', 1, 'run-b', 'running', 0, 1),
      ('session-a', 1, 'run-a', 'running', 0, 1),
      ('session-idle', 1, NULL, 'running', 0, 1)`
  yield* sql`INSERT INTO session_operations
      (caller_id, operation, target_scope, idempotency_key, request_json, status, outcome_json,
        created_at, updated_at)
    VALUES ('caller', 'message', 'session-a', 'key-1', '{}', 'pending', NULL, 2, 2),
      ('caller', 'archive', 'session-b', 'key-2', '{}', 'completed', '{}', 1, 1)`
  for (const [id, status, createdAt] of [
    ['export-queued', 'queued', 3],
    ['export-running', 'running', 4],
    ['export-installing', 'installing', 5],
    ['export-cancelling', 'cancelling', 6],
    ['export-completed', 'completed', 1],
  ] as const) {
    yield* insertExport(sql, id, status, createdAt)
  }
  yield* sql`INSERT INTO project_action_runs (id, workspace_id, action_id, status, started_at, record_json)
    VALUES ('action-starting', 'workspace-1', 'dev', 'starting', 7, '{}'),
      ('action-stopping', 'workspace-2', 'dev', 'stopping', 8, '{}'),
      ('action-exited', 'workspace-3', 'dev', 'exited', 1, '{}')`
  yield* sql`INSERT INTO workspace_preparation (workspace_id, revision, state_json)
    VALUES ('workspace-setup', 1, '{"setup":{"status":"running"}}'),
      ('workspace-cleanup', 1, '{"cleanup":{"status":"running"}}'),
      ('workspace-done', 1, '{"setup":{"status":"succeeded"}}')`
})

describe('Session Host upgrade blockers', () => {
  it('reads every blocker through the Host connection', async () => {
    const blockers = await runOnHostConnection(
      Effect.zipRight(seedEveryBlockerKind, readSessionHostUpgradeBlockers),
    )

    expect(blockers).toEqual({
      blockingRuns: [
        { sessionId: 'session-a', runId: 'run-a' },
        { sessionId: 'session-b', runId: 'run-b' },
      ],
      blockingOperations: [
        { operationId: '1', operation: 'message', targetScope: 'session-a' },
        { operationId: 'export-queued', operation: 'export', targetScope: 'session-export-queued' },
        {
          operationId: 'export-running',
          operation: 'export',
          targetScope: 'session-export-running',
        },
        {
          operationId: 'export-installing',
          operation: 'export',
          targetScope: 'session-export-installing',
        },
        {
          operationId: 'export-cancelling',
          operation: 'export',
          targetScope: 'session-export-cancelling',
        },
        { operationId: 'action-starting', operation: 'project-action', targetScope: 'workspace-1' },
        { operationId: 'action-stopping', operation: 'project-action', targetScope: 'workspace-2' },
        {
          operationId: 'workspace-cleanup',
          operation: 'workspace-preparation',
          targetScope: 'workspace-cleanup',
        },
        {
          operationId: 'workspace-setup',
          operation: 'workspace-preparation',
          targetScope: 'workspace-setup',
        },
      ],
    })
  })

  it('reports nothing for an idle Host', async () => {
    await expect(runOnHostConnection(readSessionHostUpgradeBlockers)).resolves.toEqual({
      blockingRuns: [],
      blockingOperations: [],
    })
  })

  it("sees the Host connection's own uncommitted writes instead of a second connection's snapshot", async () => {
    // A second connection, as the node:sqlite reader was, cannot see this transaction's Run.
    const blockers = await runOnHostConnection(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT INTO session_control_states
                (session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at)
              VALUES ('session-in-transaction', 1, 'run-in-transaction', 'running', 0, 1)`
            return yield* readSessionHostUpgradeBlockers
          }),
        )
      }),
    )

    expect(blockers.blockingRuns).toEqual([
      { sessionId: 'session-in-transaction', runId: 'run-in-transaction' },
    ])
  })
})
