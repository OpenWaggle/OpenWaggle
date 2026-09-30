import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterAll, describe, expect, it } from 'vitest'
import type { PrepareSessionLifecycleInput } from '../../ports/session-lifecycle-preparation-service'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { describeLocalSessionServerError } from '../../session-host/local-session-server-frame'
import { prepareLifecycleWorkspacePlan } from '../session-lifecycle-workspace-plan'

const root = mkdtempSync(path.join(tmpdir(), 'openwaggle-workspace-plan-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const PROJECT = '/code/app'
const WORKTREE = '/worktrees/app/w-1'

function input(initiatingWorkingDirectory: string | undefined): PrepareSessionLifecycleInput {
  return fromPartial({
    ...(initiatingWorkingDirectory ? { initiatingWorkingDirectory } : {}),
    identities: { workspaceId: 'workspace-new' },
    request: { command: { operation: 'launch', projectPath: PROJECT } },
  })
}

function plan(workingDirectory: string | undefined) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`
        CREATE TABLE IF NOT EXISTS workspace_resources (
          id TEXT PRIMARY KEY,
          project_path TEXT NOT NULL,
          kind TEXT NOT NULL,
          working_path TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL
        )
      `)
      yield* sql`DELETE FROM workspace_resources`
      yield* sql`
        INSERT INTO workspace_resources (id, project_path, kind, working_path, lifecycle_state)
        VALUES
          (${'local-1'}, ${PROJECT}, ${'local'}, ${PROJECT}, ${'ready'}),
          (${'worktree-1'}, ${PROJECT}, ${'managed-worktree'}, ${WORKTREE}, ${'ready'}),
          (${'pending-1'}, ${PROJECT}, ${'managed-worktree'}, ${'/worktrees/app/w-2'}, ${'pending'})
      `
      return yield* prepareLifecycleWorkspacePlan(sql, input(workingDirectory), PROJECT, undefined)
    }).pipe(
      Effect.provide(
        SqliteClient.layer({
          filename: path.join(root, `${String(Math.random())}.sqlite`),
          prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
        }),
      ),
    ),
  )
}

describe('launch into the current Workspace', () => {
  it('uses the exact Workspace the caller works in', async () => {
    expect(await plan(WORKTREE)).toEqual({ mode: 'existing', workspaceId: 'worktree-1' })
  })

  it('uses the Workspace that contains the caller directory', async () => {
    expect(await plan(`${WORKTREE}/src/lib`)).toEqual({
      mode: 'existing',
      workspaceId: 'worktree-1',
    })
    expect(await plan(`${PROJECT}/packages/core`)).toEqual({
      mode: 'existing',
      workspaceId: 'local-1',
    })
  })

  it('uses the named project checkout for a caller outside every Workspace', async () => {
    expect(await plan('/somewhere/else')).toEqual({ mode: 'existing', workspaceId: 'local-1' })
  })

  it('refuses a caller inside a worktree that is not ready instead of moving it', async () => {
    const failure = await plan('/worktrees/app/w-2/src').catch((error: unknown) => error)
    expect(describeLocalSessionServerError(failure)).toContain('initiating-workspace-not-ready')
    expect(describeLocalSessionServerError(failure)).toContain(
      'The worktree at /worktrees/app/w-2 is pending.',
    )
  })

  it('does not treat a sibling directory with a shared prefix as inside a Workspace', async () => {
    expect(await plan(`${WORKTREE}-other`)).toEqual({ mode: 'existing', workspaceId: 'local-1' })
  })
})
