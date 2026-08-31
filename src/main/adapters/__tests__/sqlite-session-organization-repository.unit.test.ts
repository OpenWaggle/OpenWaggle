import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { organizeSession } from '../../application/session-organization-service'
import {
  decodeSessionAuthoritySnapshot,
  encodeSessionAuthoritySnapshot,
} from '../../session-host/session-authority-snapshot'
import { resolveSessionToolAgentCaller } from '../../session-host/session-tool-agent-caller'
import { liveSessionAuthorityBlockReason } from '../sqlite-session-live-authority'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

describe('SQLite Session organization repository', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-organization-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('renames and archives idempotently through the durable operation journal', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'host.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const renameRequest = {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'rename-request',
          idempotencyKey: 'rename-key',
          command: { operation: 'rename', sessionId: 'session-target', title: 'New title' },
        } as const
        const rename = yield* organizeSession({ callerId: 'local-user', request: renameRequest })
        const replay = yield* organizeSession({ callerId: 'local-user', request: renameRequest })
        const archive = yield* organizeSession({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'archive-request',
            idempotencyKey: 'archive-key',
            command: { operation: 'archive', sessionId: 'session-target' },
          },
        })
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ readonly title: string; readonly archived: number }>`
          SELECT title, archived FROM sessions WHERE id = ${'session-target'}
        `
        return { rename, replay, archive, row: rows[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.rename.outcome).toMatchObject({ effect: 'session-renamed', title: 'New title' })
    expect(result.replay).toEqual({ ...result.rename, replayed: true })
    expect(result.archive.outcome).toMatchObject({ effect: 'session-archived' })
    expect(result.row).toEqual({ title: 'New title', archived: 1 })
  })

  it('hands an idle Session to a new pending worktree and rejects an active Session', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'handoff.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const request = {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'handoff-request',
          idempotencyKey: 'handoff-key',
          command: {
            operation: 'handoff',
            sessionId: 'session-target',
            workspace: { mode: 'new-worktree', baseRef: 'main' },
          },
        } as const
        const handoff = yield* organizeSession({ callerId: 'local-user', request })
        const replay = yield* organizeSession({ callerId: 'local-user', request })
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          readonly environment_mode: string
          readonly workspace_id: string
          readonly lifecycle_state: string
          readonly worktree_base_ref: string | null
        }>`
          SELECT sessions.environment_mode, session_workspace_bindings.workspace_id,
            workspace_resources.lifecycle_state, workspace_resources.worktree_base_ref
          FROM sessions
          JOIN session_workspace_bindings ON session_workspace_bindings.session_id = sessions.id
          JOIN workspace_resources ON workspace_resources.id = session_workspace_bindings.workspace_id
          WHERE sessions.id = ${'session-target'}
        `
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
          VALUES (${'run-active'}, ${'session-target'}, ${'active'}, ${null}, ${2000}, ${2000})
        `
        yield* sql`
          UPDATE session_control_states SET active_run_id = ${'run-active'}
          WHERE session_id = ${'session-target'}
        `
        const rejected = yield* organizeSession({
          callerId: 'local-user',
          request: {
            ...request,
            requestId: 'handoff-active-request',
            idempotencyKey: 'handoff-active-key',
            command: {
              operation: 'handoff',
              sessionId: 'session-target',
              workspace: { mode: 'local' },
            },
          },
        })
        return { handoff, replay, rejected, row: rows[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.handoff.outcome).toMatchObject({
      effect: 'session-handed-off',
      previousWorkspaceId: 'workspace-local',
      workspaceState: 'pending',
    })
    expect(result.replay).toEqual({ ...result.handoff, replayed: true })
    expect(result.rejected.outcome).toMatchObject({ effect: 'rejected', code: 'session_not_idle' })
    expect(result.row).toMatchObject({
      environment_mode: 'worktree',
      lifecycle_state: 'pending',
      worktree_base_ref: 'main',
    })
  })

  it('refreshes ready-handoff authority atomically and no longer depends on the old tree', async () => {
    const projectCandidate = path.join(temporaryRoot, 'project')
    const oldWorkingCandidate = path.join(temporaryRoot, 'old-worktree')
    await fs.mkdir(projectCandidate)
    await fs.mkdir(oldWorkingCandidate)
    const projectPath = await fs.realpath(projectCandidate)
    const oldWorkingPath = await fs.realpath(oldWorkingCandidate)
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'authority-handoff.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE sessions SET project_path = ${projectPath} WHERE id = ${'session-target'}
        `
        yield* sql`
          UPDATE workspace_resources
          SET project_path = ${projectPath}, working_path = ${oldWorkingPath}
          WHERE id = ${'workspace-local'}
        `
        yield* sql`
          INSERT INTO session_execution_profiles (
            session_id, profile_json, resolved_agent_snapshot_json,
            authority_origin_caller_id, authority_scope_snapshot_json,
            authorization_ceiling, created_at, updated_at
          ) VALUES (
            ${'session-target'},
            ${'{"modelId":"openai-codex/gpt-5.6-sol","thinkingLevel":"low"}'}, ${null},
            ${'local-user'}, ${encodeSessionAuthoritySnapshot({
              scope: {
                projectPaths: [projectPath],
                exportRoots: [oldWorkingPath],
                attachmentRoots: [oldWorkingPath],
              },
              projectPath,
              workingPath: oldWorkingPath,
            })},
            ${'ask-for-approval'}, ${1000}, ${1000}
          )
        `
        const response = yield* organizeSession({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'local-handoff-request',
            idempotencyKey: 'local-handoff-key',
            command: {
              operation: 'handoff',
              sessionId: 'session-target',
              workspace: { mode: 'local' },
            },
          },
        })
        const rows = yield* sql<{
          readonly authority_scope_snapshot_json: string
          readonly working_path: string
        }>`
          SELECT session_execution_profiles.authority_scope_snapshot_json,
            workspace_resources.working_path
          FROM session_execution_profiles
          JOIN session_workspace_bindings
            ON session_workspace_bindings.session_id = session_execution_profiles.session_id
          JOIN workspace_resources
            ON workspace_resources.id = session_workspace_bindings.workspace_id
          WHERE session_execution_profiles.session_id = ${'session-target'}
        `
        yield* Effect.promise(() => fs.rm(oldWorkingPath, { recursive: true, force: true }))
        const block = yield* liveSessionAuthorityBlockReason(sql, 'local-user', 'session-target')
        const caller = yield* resolveSessionToolAgentCaller(sql, {
          sessionId: 'session-target',
          runId: 'run-after-handoff',
          workingDirectory: projectPath,
        })
        const oldCaller = yield* resolveSessionToolAgentCaller(sql, {
          sessionId: 'session-target',
          runId: 'run-old-tree',
          workingDirectory: oldWorkingPath,
        }).pipe(Effect.either)
        return { response, row: rows[0], block, caller, oldCaller }
      }).pipe(Effect.provide(layer)),
    )
    const snapshot = decodeSessionAuthoritySnapshot(result.row?.authority_scope_snapshot_json)

    expect(result.response.outcome.effect).toBe('session-handed-off')
    expect(result.row?.working_path).toBe(projectPath)
    expect(snapshot).toEqual({
      scope: {
        projectPaths: [projectPath],
        exportRoots: [projectPath],
        attachmentRoots: [projectPath],
      },
      projectPath,
      workingPath: projectPath,
    })
    expect(result.block).toBeUndefined()
    expect(result.caller.profileAuthority?.scope).toMatchObject({
      exportRoots: [projectPath],
      attachmentRoots: [projectPath],
    })
    expect(result.oldCaller._tag).toBe('Left')
  })
})
