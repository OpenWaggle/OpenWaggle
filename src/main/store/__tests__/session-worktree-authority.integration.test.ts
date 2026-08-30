import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveSessionAuthorityBlockReason } from '../../adapters/sqlite-session-live-authority'
import {
  decodeSessionAuthoritySnapshot,
  encodeSessionAuthoritySnapshot,
} from '../../session-host/session-authority-snapshot'
import { resolveSessionToolAgentCaller } from '../../session-host/session-tool-agent-caller'
import { createSession, setSessionWorktree } from '../session-details'
import { runStoreEffect } from '../store-runtime'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

describe('Session worktree authority', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-worktree-authority-')),
    )
    state.userDataDir = path.join(temporaryRoot, 'user-data')
    await fs.mkdir(state.userDataDir)
    const { resetAppRuntimeForTests } = await import('../../runtime')
    await resetAppRuntimeForTests()
  })

  afterEach(async () => {
    const { resetAppRuntimeForTests } = await import('../../runtime')
    await resetAppRuntimeForTests()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('atomically moves generated roots when a pending worktree is born', async () => {
    const projectPath = path.join(temporaryRoot, 'project')
    const oldWorkingPath = path.join(temporaryRoot, 'old-worktree')
    const newWorkingPath = path.join(temporaryRoot, 'new-worktree')
    await Promise.all([fs.mkdir(projectPath), fs.mkdir(oldWorkingPath), fs.mkdir(newWorkingPath)])
    const first = await createSession({ projectPath, piSessionId: 'pi-authority-birth-first' })
    const second = await createSession({ projectPath, piSessionId: 'pi-authority-birth-second' })
    const firstSessionId = SessionId(String(first.id))
    const secondSessionId = SessionId(String(second.id))
    const workspaceId = 'workspace-authority-birth'
    const plannedWorkingPath = `pending://${workspaceId}`
    const initialSnapshot = encodeSessionAuthoritySnapshot({
      scope: {
        projectPaths: [projectPath],
        exportRoots: [plannedWorkingPath],
        attachmentRoots: [plannedWorkingPath],
      },
      projectPath,
      workingPath: plannedWorkingPath,
    })
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO workspace_resources (
            id, project_path, kind, working_path, lifecycle_state,
            worktree_branch, worktree_start_from_origin, created_at, updated_at
          ) VALUES (
            ${workspaceId}, ${projectPath}, ${'managed-worktree'}, ${plannedWorkingPath},
            ${'pending'}, ${'ow/authority-birth'}, ${0}, ${1000}, ${1000}
          )
        `
        for (const sessionId of [firstSessionId, secondSessionId]) {
          yield* sql`
            INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
            VALUES (${sessionId}, ${workspaceId}, ${1000})
          `
          yield* sql`
            INSERT INTO session_execution_profiles (
              session_id, profile_json, authority_origin_caller_id,
              authority_scope_snapshot_json, authorization_ceiling, created_at, updated_at
            ) VALUES (
              ${sessionId}, ${'{"modelId":"openai-codex/gpt-5.6-sol","thinkingLevel":"low"}'},
              ${'gui:local-user'}, ${initialSnapshot},
              ${'ask-for-approval'}, ${1000}, ${1000}
            )
          `
        }
      }),
    )

    await setSessionWorktree(firstSessionId, 'worktree', newWorkingPath, 'ow/authority-birth')
    await fs.rm(oldWorkingPath, { recursive: true, force: true })
    const result = await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          readonly authority_scope_snapshot_json: string
          readonly session_id: string
          readonly worktree_path: string | null
        }>`
          SELECT session_execution_profiles.session_id,
            session_execution_profiles.authority_scope_snapshot_json, sessions.worktree_path
          FROM session_execution_profiles
          JOIN sessions ON sessions.id = session_execution_profiles.session_id
          WHERE session_execution_profiles.session_id IN ${sql.in([
            firstSessionId,
            secondSessionId,
          ])}
          ORDER BY session_execution_profiles.session_id
        `
        const workspaces = yield* sql<{
          readonly lifecycle_state: string
          readonly working_path: string
        }>`
          SELECT lifecycle_state, working_path FROM workspace_resources WHERE id = ${workspaceId}
        `
        const block = yield* liveSessionAuthorityBlockReason(sql, 'local-user', firstSessionId)
        const caller = yield* resolveSessionToolAgentCaller(sql, {
          sessionId: firstSessionId,
          runId: 'run-after-birth',
          workingDirectory: newWorkingPath,
        }).pipe(Effect.either)
        return { rows, workspace: workspaces[0], block, caller }
      }),
    )

    const expectedSnapshot = {
      scope: {
        projectPaths: [projectPath],
        exportRoots: [newWorkingPath],
        attachmentRoots: [newWorkingPath],
      },
      projectPath,
      workingPath: newWorkingPath,
    }
    expect(result.rows).toHaveLength(2)
    for (const row of result.rows) {
      expect(row.worktree_path).toBe(newWorkingPath)
      expect(decodeSessionAuthoritySnapshot(row.authority_scope_snapshot_json)).toEqual(
        expectedSnapshot,
      )
    }
    expect(result.workspace).toEqual({ lifecycle_state: 'ready', working_path: newWorkingPath })
    expect(result.block).toBeUndefined()
    expect(result.caller._tag).toBe('Right')
    if (result.caller._tag === 'Right') {
      expect(result.caller.right.workingDirectory).toBe(newWorkingPath)
    }
  })

  it('rolls back the whole birth when one peer authority snapshot is invalid', async () => {
    const projectPath = path.join(temporaryRoot, 'rollback-project')
    const oldWorkingPath = path.join(temporaryRoot, 'rollback-old')
    const newWorkingPath = path.join(temporaryRoot, 'rollback-new')
    await Promise.all([fs.mkdir(projectPath), fs.mkdir(oldWorkingPath), fs.mkdir(newWorkingPath)])
    const first = await createSession({ projectPath, piSessionId: 'pi-rollback-first' })
    const second = await createSession({ projectPath, piSessionId: 'pi-rollback-second' })
    const firstSessionId = SessionId(String(first.id))
    const secondSessionId = SessionId(String(second.id))
    const workspaceId = 'workspace-authority-rollback'
    const validSnapshot = encodeSessionAuthoritySnapshot({
      scope: { projectPaths: [projectPath], exportRoots: [oldWorkingPath] },
      projectPath,
      workingPath: oldWorkingPath,
    })
    const invalidSnapshot = encodeSessionAuthoritySnapshot({
      scope: { projectPaths: [projectPath], exportRoots: [oldWorkingPath] },
      projectPath: path.join(temporaryRoot, 'wrong-project'),
      workingPath: oldWorkingPath,
    })
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO workspace_resources (
            id, project_path, kind, working_path, lifecycle_state,
            worktree_start_from_origin, created_at, updated_at
          ) VALUES (
            ${workspaceId}, ${projectPath}, ${'managed-worktree'}, ${newWorkingPath},
            ${'pending'}, ${0}, ${1000}, ${1000}
          )
        `
        for (const [sessionId, snapshot] of [
          [firstSessionId, validSnapshot],
          [secondSessionId, invalidSnapshot],
        ] as const) {
          yield* sql`
            INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
            VALUES (${sessionId}, ${workspaceId}, ${1000})
          `
          yield* sql`
            INSERT INTO session_execution_profiles (
              session_id, profile_json, authority_origin_caller_id,
              authority_scope_snapshot_json, authorization_ceiling, created_at, updated_at
            ) VALUES (
              ${sessionId}, ${'{"modelId":"openai-codex/gpt-5.6-sol","thinkingLevel":"low"}'},
              ${'gui:local-user'}, ${snapshot},
              ${'ask-for-approval'}, ${1000}, ${1000}
            )
          `
        }
      }),
    )

    await expect(setSessionWorktree(firstSessionId, 'worktree', newWorkingPath)).rejects.toThrow(
      'Session project differs from its authority snapshot.',
    )
    const stateAfterFailure = await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const sessions = yield* sql<{ readonly id: string; readonly worktree_path: string | null }>`
          SELECT id, worktree_path FROM sessions
          WHERE id IN ${sql.in([firstSessionId, secondSessionId])} ORDER BY id
        `
        const workspaces = yield* sql<{
          readonly lifecycle_state: string
          readonly working_path: string
        }>`
          SELECT lifecycle_state, working_path FROM workspace_resources WHERE id = ${workspaceId}
        `
        const snapshots = yield* sql<{
          readonly authority_scope_snapshot_json: string
          readonly session_id: string
        }>`
          SELECT session_id, authority_scope_snapshot_json FROM session_execution_profiles
          WHERE session_id IN ${sql.in([firstSessionId, secondSessionId])} ORDER BY session_id
        `
        return { sessions, workspace: workspaces[0], snapshots }
      }),
    )

    expect(stateAfterFailure.sessions.every((session) => session.worktree_path === null)).toBe(true)
    expect(stateAfterFailure.workspace).toEqual({
      lifecycle_state: 'pending',
      working_path: newWorkingPath,
    })
    expect(
      stateAfterFailure.snapshots.map((row) => row.authority_scope_snapshot_json).sort(),
    ).toEqual([validSnapshot, invalidSnapshot].sort())
  })
})
