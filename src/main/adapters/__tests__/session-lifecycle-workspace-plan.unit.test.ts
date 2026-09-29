import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SessionId, WorkspaceId } from '@shared/types/brand'
import type { LaunchWorkspaceSelection } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { sessionCommandFailureMessage } from '../../session-host/session-command-failure-message'
import { prepareLifecycleWorkspacePlan } from '../session-lifecycle-workspace-plan'

const GOSAFE = '/projects/gosafe'
const GOSAFE_WORKTREE = '/worktrees/gosafe/0fae53b9'
const OPENWAGGLE = '/projects/openwaggle'

describe('Session lifecycle workspace plan across projects', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-workspace-plan-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  function plan(workspace: LaunchWorkspaceSelection | undefined, workingDirectory: string) {
    const database = SqliteClient.layer({
      filename: path.join(root, 'workspaces.sqlite'),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS workspace_resources (
          id TEXT PRIMARY KEY, project_path TEXT NOT NULL, kind TEXT NOT NULL,
          working_path TEXT NOT NULL, lifecycle_state TEXT NOT NULL
        )`)
        yield* sql`INSERT OR IGNORE INTO workspace_resources VALUES
          (${'gosafe-worktree'}, ${GOSAFE}, ${'managed-worktree'}, ${GOSAFE_WORKTREE}, ${'ready'}),
          (${'openwaggle-local'}, ${OPENWAGGLE}, ${'local'}, ${OPENWAGGLE}, ${'ready'})`
        return yield* prepareLifecycleWorkspacePlan(
          sql,
          {
            callerId: 'session-agent:gosafe-root:run',
            initiatingWorkingDirectory: workingDirectory,
            identities: {
              sessionId: SessionId('new-session'),
              workspaceId: WorkspaceId('new-workspace'),
            },
            request: {
              contractVersion: 2,
              requestId: 'request-launch',
              idempotencyKey: 'idempotency-launch',
              command: {
                operation: 'launch',
                projectPath: OPENWAGGLE,
                objective: 'Fix the bug.',
                attachmentIds: [],
                ...(workspace ? { workspace } : {}),
              },
            },
          },
          OPENWAGGLE,
          undefined,
        )
      }).pipe(Effect.provide(database)),
    )
  }

  it("uses the target project's local checkout when the Workspace is omitted", async () => {
    await expect(plan(undefined, GOSAFE_WORKTREE)).resolves.toEqual({
      mode: 'existing',
      workspaceId: 'openwaggle-local',
    })
  })

  it('provisions a worktree of the target project for new-worktree', async () => {
    await expect(plan({ mode: 'new-worktree' }, GOSAFE_WORKTREE)).resolves.toMatchObject({
      mode: 'provisioned',
      workspace: { projectPath: OPENWAGGLE, kind: 'managed-worktree' },
    })
  })

  it('refuses an explicit current Workspace from another project with the reason', async () => {
    const failure = await plan({ mode: 'current' }, GOSAFE_WORKTREE).then(
      () => undefined,
      (error: unknown) => error,
    )
    const message = sessionCommandFailureMessage(failure)
    expect(message).toContain('initiating-workspace-in-another-project')
    expect(message).toContain('Use workspace "local" or "new-worktree"')
  })

  it('still refuses an unknown initiating Workspace', async () => {
    await expect(plan(undefined, '/somewhere/else')).rejects.toThrow()
  })
})
