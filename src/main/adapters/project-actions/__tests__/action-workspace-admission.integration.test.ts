import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { expect, it } from 'vitest'
import { createActionWorkspaceAdmission } from '../action-workspace-admission'

it('retains an admitted native launch fence after the requesting fiber is interrupted', async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const admission = createActionWorkspaceAdmission(sql)
      const entered = yield* Deferred.make<void>()
      const nativeLaunch = Promise.withResolvers<void>()
      const events: string[] = []
      const start = yield* Effect.fork(
        admission.withWorkspaceMutation(
          'workspace',
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined)
            yield* Effect.promise(async () => {
              await nativeLaunch.promise
              events.push('process launched')
            })
          }),
        ),
      )
      yield* Deferred.await(entered)
      yield* Fiber.interruptFork(start)
      const release = yield* Effect.fork(
        admission.withWorkspaceMutation(
          'workspace',
          Effect.sync(() => {
            events.push('workspace released')
          }),
        ),
      )
      yield* Effect.sleep('20 millis')
      expect(events).toEqual([])
      nativeLaunch.resolve()
      yield* Fiber.await(start)
      yield* Fiber.join(release)
      expect(events).toEqual(['process launched', 'workspace released'])
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' }))),
  )
})

it('serializes starts with final release and rejects a start from the released Session', async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE sessions(id TEXT PRIMARY KEY, archived INTEGER)`
      yield* sql`CREATE TABLE workspace_resources(id TEXT PRIMARY KEY, project_path TEXT, working_path TEXT, lifecycle_state TEXT)`
      yield* sql`CREATE TABLE session_workspace_bindings(session_id TEXT, workspace_id TEXT)`
      yield* sql`INSERT INTO sessions VALUES ('session', 0), ('other', 0)`
      yield* sql`INSERT INTO workspace_resources VALUES ('workspace', '/project', '/worktree', 'ready')`
      yield* sql`INSERT INTO session_workspace_bindings VALUES ('session', 'workspace'), ('other', 'workspace')`
      const admission = createActionWorkspaceAdmission(sql)
      const workspace = {
        workspaceId: 'workspace',
        projectPath: '/project',
        workspacePath: '/worktree',
        sessionId: 'session',
      }
      const launched = yield* Deferred.make<void>()
      const releaseStart = yield* Deferred.make<void>()
      const events: string[] = []
      const start = yield* Effect.fork(
        admission.withWorkspaceMutation(
          workspace.workspaceId,
          Effect.gen(function* () {
            yield* admission.requireActive(workspace)
            events.push('start')
            yield* Deferred.succeed(launched, undefined)
            yield* Deferred.await(releaseStart)
          }),
        ),
      )
      yield* Deferred.await(launched)
      const archive = yield* Effect.fork(
        admission.withWorkspaceMutation(
          workspace.workspaceId,
          Effect.gen(function* () {
            events.push('stop')
            yield* sql`UPDATE sessions SET archived = 1 WHERE id = 'session'`
          }),
        ),
      )
      yield* Deferred.succeed(releaseStart, undefined)
      yield* Fiber.join(start)
      yield* Fiber.join(archive)
      expect(events).toEqual(['start', 'stop'])
      const rejected = yield* admission.requireActive(workspace).pipe(Effect.either)
      expect(rejected._tag).toBe('Left')
      yield* admission.requireActive({ ...workspace, sessionId: 'other' })
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' }))),
  )
})
