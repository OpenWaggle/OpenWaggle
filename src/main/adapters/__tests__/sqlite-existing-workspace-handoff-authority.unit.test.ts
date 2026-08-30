import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { organizeSession } from '../../application/session-organization-service'
import type { PreparedWorkspaceHandoff } from '../../ports/session-workspace-handoff-service'
import {
  decodeSessionAuthoritySnapshot,
  encodeSessionAuthoritySnapshot,
} from '../../session-host/session-authority-snapshot'
import { resolveSessionToolAgentCaller } from '../../session-host/session-tool-agent-caller'
import { liveSessionAuthorityBlockReason } from '../sqlite-session-live-authority'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

describe('existing Workspace handoff authority', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-existing-handoff-authority-')),
    )
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('switches binding and authority snapshot in one successful completion', async () => {
    const projectPath = path.join(temporaryRoot, 'project')
    const sourcePath = path.join(temporaryRoot, 'source')
    const targetPath = path.join(temporaryRoot, 'target')
    await Promise.all([fs.mkdir(projectPath), fs.mkdir(sourcePath), fs.mkdir(targetPath)])
    const prepared = {
      transfer: 'deferred-existing',
      workspaceId: 'workspace-existing',
      projectPath,
      sourceWorkingPath: sourcePath,
      workingPath: targetPath,
      sourceHead: 'source-head',
      snapshotRef: 'refs/openwaggle/authority-source',
      targetSnapshotRef: 'refs/openwaggle/authority-target',
    } satisfies PreparedWorkspaceHandoff
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'handoff.sqlite'), {
      prepare: () => Effect.succeed(prepared),
      apply: () => Effect.void,
      rollback: () => Effect.void,
      complete: () => Effect.void,
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE sessions SET project_path = ${projectPath} WHERE id = ${'session-target'}`
        yield* sql`
          UPDATE workspace_resources
          SET project_path = ${projectPath}, working_path = ${sourcePath}
          WHERE id = ${'workspace-local'}
        `
        yield* sql`
          INSERT INTO workspace_resources (
            id, project_path, kind, working_path, lifecycle_state,
            worktree_branch, worktree_base_ref, worktree_start_from_origin,
            created_at, updated_at
          ) VALUES (
            ${'workspace-existing'}, ${projectPath}, ${'managed-worktree'}, ${targetPath},
            ${'ready'}, ${'ow/existing'}, ${'source-head'}, ${0}, ${1000}, ${1000}
          )
        `
        const initialSnapshot = encodeSessionAuthoritySnapshot({
          scope: {
            projectPaths: [projectPath],
            exportRoots: [sourcePath],
            attachmentRoots: [sourcePath],
          },
          projectPath,
          workingPath: sourcePath,
        })
        yield* sql`
          INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id,
            authority_scope_snapshot_json, authorization_ceiling, created_at, updated_at
          ) VALUES (
            ${'session-target'}, ${'{"modelId":"openai-codex/gpt-5.6-sol","thinkingLevel":"low"}'},
            ${'local-user'}, ${initialSnapshot}, ${'ask-for-approval'}, ${1000}, ${1000}
          )
        `
        const response = yield* organizeSession({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'existing-authority-request',
            idempotencyKey: 'existing-authority-key',
            command: {
              operation: 'handoff',
              sessionId: 'session-target',
              workspace: { mode: 'existing', workspaceId: 'workspace-existing' },
            },
          },
        })
        const rows = yield* sql<{
          readonly workspace_id: string
          readonly authority_scope_snapshot_json: string
        }>`
          SELECT session_workspace_bindings.workspace_id,
            session_execution_profiles.authority_scope_snapshot_json
          FROM session_workspace_bindings
          JOIN session_execution_profiles
            ON session_execution_profiles.session_id = session_workspace_bindings.session_id
          WHERE session_workspace_bindings.session_id = ${'session-target'}
        `
        yield* Effect.promise(() => fs.rm(sourcePath, { recursive: true, force: true }))
        const block = yield* liveSessionAuthorityBlockReason(sql, 'local-user', 'session-target')
        const caller = yield* resolveSessionToolAgentCaller(sql, {
          sessionId: 'session-target',
          runId: 'run-after-existing-handoff',
          workingDirectory: targetPath,
        })
        return { response, row: rows[0], block, caller }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome.effect).toBe('session-handed-off')
    expect(result.row?.workspace_id).toBe('workspace-existing')
    expect(decodeSessionAuthoritySnapshot(result.row?.authority_scope_snapshot_json)).toEqual({
      scope: {
        projectPaths: [projectPath],
        exportRoots: [targetPath],
        attachmentRoots: [targetPath],
      },
      projectPath,
      workingPath: targetPath,
    })
    expect(result.block).toBeUndefined()
    expect(result.caller.workingDirectory).toBe(targetPath)
    expect(result.caller.profileAuthority?.scope).toMatchObject({
      exportRoots: [targetPath],
      attachmentRoots: [targetPath],
    })
  })
})
