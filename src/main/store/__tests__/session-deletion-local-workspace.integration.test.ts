import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveLifecycleWorkspace } from '../../adapters/sqlite-session-lifecycle-support'
import {
  archiveSession,
  commitSessionDeletion,
  createSession,
  prepareSessionDeletion,
} from '../session-details'
import { runStoreEffect } from '../store-runtime'

const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

async function bindLocalSession(name: string) {
  const session = await createSession({ projectPath: state.userDataDir, piSessionId: name })
  const workspaceId = await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const workspace = yield* resolveLifecycleWorkspace(
            sql,
            {
              mode: 'provisioned',
              workspace: {
                id: `workspace-${name}`,
                projectPath: state.userDataDir,
                workingPath: state.userDataDir,
                kind: 'local',
                lifecycleState: 'ready',
              },
            },
            undefined,
            Date.now(),
          )
          yield* sql`INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
          VALUES (${session.id}, ${workspace.id}, ${Date.now()})`
          return workspace.id
        }),
      )
    }),
  )
  return { sessionId: session.id, workspaceId }
}

async function seedActionState(workspaceId: string) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO workspace_preparation (workspace_id, revision, state_json)
      VALUES (${workspaceId}, 1, ${JSON.stringify({ environment: { SECRET: 'private-export' } })})`
      yield* sql`INSERT INTO project_action_runs (id, workspace_id, action_id, status, started_at, record_json)
      VALUES ('local-action-run', ${workspaceId}, 'task', 'completed', 1, '{}')`
      yield* sql`INSERT INTO project_action_run_requests (workspace_id, action_id, request_id, run_id)
      VALUES (${workspaceId}, 'task', 'request', 'local-action-run')`
    }),
  )
}

async function readActionState(workspaceId: string) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql`
      SELECT
        (SELECT COUNT(*) FROM workspace_resources WHERE id = ${workspaceId}) AS workspace,
        (SELECT COUNT(*) FROM workspace_preparation WHERE workspace_id = ${workspaceId}) AS preparation,
        (SELECT COUNT(*) FROM project_action_runs WHERE workspace_id = ${workspaceId}) AS runs,
        (SELECT COUNT(*) FROM project_action_run_requests WHERE workspace_id = ${workspaceId}) AS receipts,
        (SELECT COUNT(*) FROM project_action_history_cleanup WHERE workspace_id = ${workspaceId}) AS cleanup
    `
      return rows[0]
    }),
  )
}

async function commitDeletion(sessionId: SessionId) {
  await prepareSessionDeletion(sessionId)
  await commitSessionDeletion(sessionId)
}

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-local-workspace-delete-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(state.userDataDir, { recursive: true, force: true })
})

describe('local Workspace retirement during durable Session deletion', () => {
  it('retires the last local binding and gives a later Session fresh preparation and action state', async () => {
    const first = await bindLocalSession('first')
    await seedActionState(first.workspaceId)
    await commitDeletion(first.sessionId)

    expect(await readActionState(first.workspaceId)).toEqual({
      workspace: 0,
      preparation: 0,
      runs: 0,
      receipts: 0,
      cleanup: 1,
    })
    expect((await fs.stat(state.userDataDir)).isDirectory()).toBe(true)
    const next = await bindLocalSession('next')
    expect(next.workspaceId).not.toBe(first.workspaceId)
    expect(await readActionState(next.workspaceId)).toEqual({
      workspace: 1,
      preparation: 0,
      runs: 0,
      receipts: 0,
      cleanup: 0,
    })
  })

  it.each([false, true])(
    'preserves another binding, including an archived peer (%s)',
    async (archived) => {
      const first = await bindLocalSession('first')
      const peer = await bindLocalSession('peer')
      expect(peer.workspaceId).toBe(first.workspaceId)
      await seedActionState(first.workspaceId)
      if (archived) await archiveSession(peer.sessionId)
      await commitDeletion(first.sessionId)

      expect(await readActionState(peer.workspaceId)).toEqual({
        workspace: 1,
        preparation: 1,
        runs: 1,
        receipts: 1,
        cleanup: 0,
      })
      await commitDeletion(peer.sessionId)
      expect(await readActionState(peer.workspaceId)).toEqual({
        workspace: 0,
        preparation: 0,
        runs: 0,
        receipts: 0,
        cleanup: 1,
      })
    },
  )

  it('preserves a binding added after deletion was prepared', async () => {
    const first = await bindLocalSession('first')
    await seedActionState(first.workspaceId)
    await prepareSessionDeletion(first.sessionId)
    const peer = await bindLocalSession('new-peer')
    await commitSessionDeletion(first.sessionId)

    expect(peer.workspaceId).toBe(first.workspaceId)
    expect(await readActionState(peer.workspaceId)).toEqual({
      workspace: 1,
      preparation: 1,
      runs: 1,
      receipts: 1,
      cleanup: 0,
    })
  })

  it('retains managed Workspace state for physical cleanup after durable deletion', async () => {
    const first = await bindLocalSession('managed')
    await seedActionState(first.workspaceId)
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE workspace_resources SET kind = 'managed-worktree' WHERE id = ${first.workspaceId}`
      }),
    )
    await commitDeletion(first.sessionId)
    expect(await readActionState(first.workspaceId)).toEqual({
      workspace: 1,
      preparation: 1,
      runs: 1,
      receipts: 1,
      cleanup: 0,
    })
  })
})
