import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import type { ActionRun } from '@shared/types/action-runs'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { PROJECT_ACTION_MIGRATION } from '../../../services/project-action-migration'
import { createSqliteActionRunPersistence } from '../sqlite-action-runs'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openwaggle-action-runs-sqlite-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function run(id: string): ActionRun {
  return {
    id,
    requestId: `request-${id}`,
    workspaceId: 'workspace',
    projectPath: root,
    workspacePath: root,
    action: {
      id: 'test',
      name: 'Test',
      icon: 'test',
      invocation: { type: 'command', command: 'test', directory: '.' },
      kind: 'task',
      allowConcurrent: false,
      autoOpenPreview: false,
    },
    invocation: { type: 'command', command: 'test', cwd: root },
    status: 'running',
    startedAt: 1,
    finishedAt: null,
    exitCode: null,
    error: null,
    previewUrl: null,
    ready: false,
    outputBytes: 8,
  }
}

it('retains request identities and history metadata after Host loss without replaying commands', async () => {
  const filename = join(root, 'runs.sqlite')
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE workspace_resources (id TEXT PRIMARY KEY)`
      yield* sql`INSERT INTO workspace_resources VALUES ('workspace')`
      for (const statement of PROJECT_ACTION_MIGRATION.statements) yield* sql.unsafe(statement)
      const persistence = createSqliteActionRunPersistence(sql)
      yield* Effect.promise(async () => {
        await persistence.save(run('one'))
        await persistence.recordRequest('workspace', 'test', 'request-one', 'one')
        await persistence.recordRequest('workspace', 'test', 'reused-request', 'one')
        await persistence.recordRequest('workspace', 'test', 'reused-request', 'one')
        await persistence.save({ ...run('two'), status: 'completed', finishedAt: 2, exitCode: 0 })
        await expect(
          persistence.recordRequest('workspace', 'test', 'reused-request', 'two'),
        ).rejects.toThrow('another run')
      })
    }).pipe(Effect.provide(SqliteClient.layer({ filename }))),
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const persistence = createSqliteActionRunPersistence(yield* SqlClient.SqlClient)
      yield* Effect.promise(async () => {
        expect((await persistence.findRequest('workspace', 'test', 'reused-request'))?.id).toBe(
          'one',
        )
        await persistence.interruptAfterHostLoss()
        expect(await persistence.get('one')).toMatchObject({
          status: 'interrupted',
          outputBytes: 8,
          requestId: 'request-one',
          ready: false,
        })
        expect(await persistence.get('two')).toMatchObject({ status: 'completed', exitCode: 0 })
        expect(await persistence.list('other-workspace')).toEqual([])
        expect((await persistence.findRequest('workspace', 'test', 'reused-request'))?.status).toBe(
          'interrupted',
        )
      })
    }).pipe(Effect.provide(SqliteClient.layer({ filename }))),
  )
})
