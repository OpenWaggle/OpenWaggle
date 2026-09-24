import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  EMPTY_ACTION_MANIFEST,
  type LocalActionState,
} from '../../../domain/project-action-catalog'
import { PROJECT_ACTION_MIGRATION } from '../../../services/project-action-migration'
import { createSqliteActionStatePersistence } from '../sqlite-action-catalog'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openwaggle-action-sqlite-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const state: LocalActionState = {
  document: {
    manifest: EMPTY_ACTION_MANIFEST,
    reviews: [],
    migration: { version: 1, legacySource: null },
  },
  pending: null,
}

it('persists private definitions and migration receipts across reconnect, with transactional revision checks', async () => {
  const filename = join(root, 'actions.sqlite')
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE workspace_resources (id TEXT PRIMARY KEY)`
      yield* sql`INSERT INTO workspace_resources VALUES ('workspace')`
      for (const statement of PROJECT_ACTION_MIGRATION.statements) yield* sql.unsafe(statement)
      const persistence = createSqliteActionStatePersistence(sql)
      yield* Effect.promise(async () => {
        const stored = await persistence.write('/project/a', 0, state)
        expect(stored.revision).toBe(1)
        expect(await persistence.read('/project/b')).toBeNull()
        await expect(persistence.write('/project/a', 0, state)).rejects.toThrow(
          'changed in local storage',
        )
        expect((await persistence.read('/project/a'))?.revision).toBe(1)
      })
    }).pipe(Effect.provide(SqliteClient.layer({ filename }))),
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const persistence = createSqliteActionStatePersistence(yield* SqlClient.SqlClient)
      yield* Effect.promise(async () => {
        expect(await persistence.read('/project/a')).toEqual({ revision: 1, state })
        expect((await persistence.write('/project/a', 1, state)).revision).toBe(2)
      })
    }).pipe(Effect.provide(SqliteClient.layer({ filename }))),
  )
})

it('persists publication identity and detects releasing, deleted, and replaced resources', async () => {
  const filename = join(root, 'publication.sqlite')
  const pending = {
    workspacePath: '/worktree',
    workspaceIdentity: { device: '1', inode: '2', birthtime: '3', resourceId: 'original' },
    previousSharedRevision: 'missing',
    nextShared: EMPTY_ACTION_MANIFEST,
    nextLocal: state.document,
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE workspace_resources (
        id TEXT PRIMARY KEY, project_path TEXT, working_path TEXT, lifecycle_state TEXT
      )`
      yield* sql`INSERT INTO workspace_resources VALUES ('original', '/project', '/worktree', 'ready')`
      for (const statement of PROJECT_ACTION_MIGRATION.statements) yield* sql.unsafe(statement)
      const persistence = createSqliteActionStatePersistence(sql)
      yield* Effect.promise(async () => {
        await persistence.write('/project', 0, { ...state, pending })
        expect(await persistence.readWorkspace('/project', '/worktree')).toEqual({
          id: 'original',
          ready: true,
        })
        expect(await persistence.readWorkspace('/other-project', '/worktree')).toBeNull()
      })
    }).pipe(Effect.provide(SqliteClient.layer({ filename }))),
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const persistence = createSqliteActionStatePersistence(sql)
      expect((yield* Effect.promise(() => persistence.read('/project')))?.state.pending).toEqual(
        pending,
      )
      yield* sql`UPDATE workspace_resources SET lifecycle_state = 'releasing'`
      expect(
        yield* Effect.promise(() => persistence.readWorkspace('/project', '/worktree')),
      ).toEqual({ id: 'original', ready: false })
      yield* sql`DELETE FROM workspace_resources`
      expect(
        yield* Effect.promise(() => persistence.readWorkspace('/project', '/worktree')),
      ).toBeNull()
      yield* sql`INSERT INTO workspace_resources VALUES ('replacement', '/project', '/worktree', 'ready')`
      expect(
        yield* Effect.promise(() => persistence.readWorkspace('/project', '/worktree')),
      ).toEqual({ id: 'replacement', ready: true })
      expect((yield* Effect.promise(() => persistence.read('/project')))?.state.pending).toEqual(
        pending,
      )
    }).pipe(Effect.provide(SqliteClient.layer({ filename }))),
  )
})
