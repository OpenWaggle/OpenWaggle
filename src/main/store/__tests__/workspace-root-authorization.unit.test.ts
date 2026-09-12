import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  findSessionWorkspaceRoot,
  listSessionWorkspaceRootPage,
} from '../session-details/workspace-root-authorization'
import { setStoreEffectRunner } from '../store-runtime'

function withWorkspaceRoots<A>(test: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT)`
      yield* sql`CREATE INDEX idx_projects ON sessions (project_path, id)`
      yield* sql`CREATE TABLE workspace_resources (
        id TEXT PRIMARY KEY, working_path TEXT, lifecycle_state TEXT
      )`
      yield* sql`CREATE INDEX idx_working_paths ON workspace_resources (working_path, id)`
      yield* sql`CREATE TABLE session_workspace_bindings (session_id TEXT, workspace_id TEXT)`
      yield* sql`CREATE INDEX idx_bindings ON session_workspace_bindings (workspace_id, session_id)`
      setStoreEffectRunner((effect) =>
        Effect.runPromise(effect.pipe(Effect.provideService(SqlClient.SqlClient, sql))),
      )
      return yield* test(sql)
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' }))),
  )
}

describe('indexed Session workspace root authorization', () => {
  it('keyset-pages distinct registered roots with bounded results and no orphan grants', async () => {
    await withWorkspaceRoots((sql) =>
      Effect.gen(function* () {
        for (let index = 0; index < 140; index += 1) {
          const root = `/project-${String(index).padStart(3, '0')}`
          yield* sql`INSERT INTO sessions VALUES (${`session-${index}`}, ${root})`
          yield* sql`INSERT INTO sessions VALUES (${`duplicate-${index}`}, ${root})`
        }
        yield* sql`INSERT INTO workspace_resources VALUES ('workspace', '/worktree', 'ready')`
        yield* sql`INSERT INTO workspace_resources VALUES ('orphan', '/orphan', 'ready')`
        yield* sql`INSERT INTO workspace_resources VALUES ('released', '/released', 'releasing')`
        yield* sql`INSERT INTO session_workspace_bindings VALUES ('session-0', 'workspace')`
        yield* sql`INSERT INTO session_workspace_bindings VALUES ('session-1', 'released')`
        const roots: string[] = []
        let after: string | undefined
        while (true) {
          const page = yield* Effect.promise(() => listSessionWorkspaceRootPage(after))
          expect(page.length).toBeLessThanOrEqual(64)
          if (page.length === 0) break
          roots.push(...page)
          after = page.at(-1)
        }
        expect(roots).toHaveLength(141)
        expect(new Set(roots).size).toBe(141)
        expect(roots.at(-1)).toBe('/worktree')
        expect(roots).not.toContain('/orphan')
        expect(roots).not.toContain('/released')
        yield* sql`DELETE FROM session_workspace_bindings`
        expect(yield* Effect.promise(() => listSessionWorkspaceRootPage('/project-139'))).toEqual(
          [],
        )
      }),
    )
  })

  it('looks up only exact project roots, including a raw migrated alias', async () => {
    await withWorkspaceRoots((sql) =>
      Effect.gen(function* () {
        yield* sql`INSERT INTO sessions VALUES ('session', '/alias/project')`
        expect(
          yield* Effect.promise(() => findSessionWorkspaceRoot('/alias/project', '/real/project')),
        ).toBe('/alias/project')
        expect(yield* Effect.promise(() => findSessionWorkspaceRoot('/alias', '/alias'))).toBeNull()
        expect(
          yield* Effect.promise(() =>
            findSessionWorkspaceRoot('/alias/project/src', '/real/project/src'),
          ),
        ).toBeNull()
      }),
    )
  })

  it('authorizes only ready working roots that still have a Session binding', async () => {
    await withWorkspaceRoots((sql) =>
      Effect.gen(function* () {
        yield* sql`INSERT INTO workspace_resources VALUES ('workspace', '/worktree', 'ready')`
        expect(
          yield* Effect.promise(() => findSessionWorkspaceRoot('/worktree', '/worktree')),
        ).toBeNull()
        yield* sql`INSERT INTO session_workspace_bindings VALUES ('session', 'workspace')`
        expect(
          yield* Effect.promise(() => findSessionWorkspaceRoot('/worktree', '/worktree')),
        ).toBe('/worktree')
        yield* sql`UPDATE workspace_resources SET lifecycle_state = 'releasing'`
        expect(
          yield* Effect.promise(() => findSessionWorkspaceRoot('/worktree', '/worktree')),
        ).toBeNull()
        yield* sql`UPDATE workspace_resources SET lifecycle_state = 'ready'`
        yield* sql`DELETE FROM session_workspace_bindings`
        expect(
          yield* Effect.promise(() => findSessionWorkspaceRoot('/worktree', '/worktree')),
        ).toBeNull()
      }),
    )
  })
})
