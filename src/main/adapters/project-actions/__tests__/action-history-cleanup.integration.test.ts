import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { expect, it, vi } from 'vitest'
import { PROJECT_ACTION_MIGRATION } from '../../../services/project-action-migration'
import { makeTerminalHistoryStore } from '../../terminal/terminal-history-store'
import { cleanupDeletedActionHistory } from '../action-history-cleanup'

it('cascades workspace secrets and run receipts, then durably retries only its history removal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openwaggle-action-cleanup-'))
  const logs = join(root, 'action-logs')
  const history = makeTerminalHistoryStore(logs)
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`PRAGMA foreign_keys = ON`
        yield* sql`CREATE TABLE workspace_resources (id TEXT PRIMARY KEY)`
        yield* sql`INSERT INTO workspace_resources VALUES ('deleted'), ('retained'), ('deleted-other')`
        for (const statement of PROJECT_ACTION_MIGRATION.statements) yield* sql.unsafe(statement)
        for (const workspace of ['deleted', 'retained', 'deleted-other']) {
          yield* sql`INSERT INTO workspace_preparation VALUES (${workspace}, 1, ${JSON.stringify({ environment: { SECRET: workspace } })})`
          yield* sql`INSERT INTO project_action_runs VALUES (${workspace}, ${workspace}, 'test', 'completed', 1, '{}')`
          yield* sql`INSERT INTO project_action_run_requests VALUES (${workspace}, 'test', 'request', ${workspace})`
          history.append(`action:${workspace}::run`, `private output for ${workspace}`)
        }
        yield* Effect.promise(() => history.flush())
        yield* sql`DELETE FROM workspace_resources WHERE id IN ('deleted', 'deleted-other')`
        for (const table of [
          'workspace_preparation',
          'project_action_runs',
          'project_action_run_requests',
        ]) {
          expect(yield* sql.unsafe(`SELECT workspace_id FROM ${table}`)).toEqual([
            { workspace_id: 'retained' },
          ])
        }
        const failOnce = vi
          .fn()
          .mockRejectedValueOnce(new Error('disk unavailable'))
          .mockImplementation((owner: string) => history.removeForOwner(owner))
        const reportFailure = vi.fn()
        const cleanup = cleanupDeletedActionHistory(
          sql,
          { removeForOwner: failOnce },
          reportFailure,
        )
        yield* cleanup
        expect(reportFailure).toHaveBeenCalledExactlyOnceWith('deleted', expect.any(Error))
        expect(yield* sql`SELECT workspace_id FROM project_action_history_cleanup`).toEqual([
          { workspace_id: 'deleted' },
        ])
        yield* cleanup
        expect(yield* sql`SELECT workspace_id FROM project_action_history_cleanup`).toEqual([])
        expect(yield* Effect.promise(() => history.read('action:deleted::run'))).toBe('')
        expect(yield* Effect.promise(() => history.read('action:retained::run'))).toBe(
          'private output for retained',
        )
        expect(yield* Effect.promise(() => readdir(logs))).toHaveLength(2)
      }).pipe(Effect.provide(SqliteClient.layer({ filename: join(root, 'test.sqlite') }))),
    )
  } finally {
    await history.flush()
    await rm(root, { recursive: true, force: true })
  }
})
