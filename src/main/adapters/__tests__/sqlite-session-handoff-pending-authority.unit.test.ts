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

describe('SQLite pending Session handoff authority', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pending-authority-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('keeps the prior snapshot during pending handoff but admits birth after the old tree is gone', async () => {
    const projectCandidate = path.join(temporaryRoot, 'pending-project')
    const oldWorkingCandidate = path.join(temporaryRoot, 'pending-old')
    await fs.mkdir(projectCandidate)
    await fs.mkdir(oldWorkingCandidate)
    const projectPath = await fs.realpath(projectCandidate)
    const oldWorkingPath = await fs.realpath(oldWorkingCandidate)
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'pending-authority.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE sessions SET project_path = ${projectPath} WHERE id = ${'session-target'}`
        yield* sql`
          UPDATE workspace_resources
          SET project_path = ${projectPath}, working_path = ${oldWorkingPath}
          WHERE id = ${'workspace-local'}
        `
        const snapshot = encodeSessionAuthoritySnapshot({
          scope: {
            projectPaths: [projectPath],
            exportRoots: [oldWorkingPath],
            attachmentRoots: [oldWorkingPath],
          },
          projectPath,
          workingPath: oldWorkingPath,
        })
        yield* sql`
          INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id,
            authority_scope_snapshot_json, authorization_ceiling, created_at, updated_at
          ) VALUES (
            ${'session-target'}, ${'{"modelId":"openai-codex/gpt-5.6-sol","thinkingLevel":"low"}'},
            ${'local-user'}, ${snapshot}, ${'ask-for-approval'}, ${1000}, ${1000}
          )
        `
        const response = yield* organizeSession({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'pending-handoff-request',
            idempotencyKey: 'pending-handoff-key',
            command: {
              operation: 'handoff',
              sessionId: 'session-target',
              workspace: { mode: 'new-worktree', baseRef: 'main' },
            },
          },
        })
        const rows = yield* sql<{
          readonly authority_scope_snapshot_json: string
          readonly lifecycle_state: string
        }>`
          SELECT session_execution_profiles.authority_scope_snapshot_json,
            workspace_resources.lifecycle_state
          FROM session_execution_profiles
          JOIN session_workspace_bindings
            ON session_workspace_bindings.session_id = session_execution_profiles.session_id
          JOIN workspace_resources
            ON workspace_resources.id = session_workspace_bindings.workspace_id
          WHERE session_execution_profiles.session_id = ${'session-target'}
        `
        yield* Effect.promise(() => fs.rm(oldWorkingPath, { recursive: true, force: true }))
        const block = yield* liveSessionAuthorityBlockReason(sql, 'local-user', 'session-target')
        return { response, row: rows[0], snapshot, block }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({
      effect: 'session-handed-off',
      workspaceState: 'pending',
    })
    expect(result.row).toEqual({
      authority_scope_snapshot_json: result.snapshot,
      lifecycle_state: 'pending',
    })
    expect(result.block).toBeUndefined()
  })

  it('never widens transient MCP filesystem roots during handoff', async () => {
    const projectCandidate = path.join(temporaryRoot, 'transient-project')
    const oldWorkingCandidate = path.join(temporaryRoot, 'transient-old')
    await fs.mkdir(projectCandidate)
    await fs.mkdir(oldWorkingCandidate)
    const projectPath = await fs.realpath(projectCandidate)
    const oldWorkingPath = await fs.realpath(oldWorkingCandidate)
    const originalSnapshot = encodeSessionAuthoritySnapshot({
      scope: {
        workspaceRoots: [oldWorkingPath],
        exportRoots: [oldWorkingPath],
        attachmentRoots: [oldWorkingPath],
        projectPaths: [projectPath],
      },
      projectPath,
      workingPath: oldWorkingPath,
    })
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'transient-handoff.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE sessions SET project_path = ${projectPath} WHERE id = ${'session-target'}`
        yield* sql`
          UPDATE workspace_resources
          SET project_path = ${projectPath}, working_path = ${oldWorkingPath}
          WHERE id = ${'workspace-local'}
        `
        yield* sql`
          INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id,
            authority_scope_snapshot_json, authorization_ceiling, created_at, updated_at
          ) VALUES (
            ${'session-target'}, ${'{"modelId":"openai-codex/gpt-5.6-sol","thinkingLevel":"low"}'},
            ${'transient-mcp:digest'}, ${originalSnapshot},
            ${'ask-for-approval'}, ${1000}, ${1000}
          )
        `
        const response = yield* organizeSession({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'transient-handoff-request',
            idempotencyKey: 'transient-handoff-key',
            command: {
              operation: 'handoff',
              sessionId: 'session-target',
              workspace: { mode: 'local' },
            },
          },
        })
        const rows = yield* sql<{ readonly authority_scope_snapshot_json: string }>`
          SELECT authority_scope_snapshot_json FROM session_execution_profiles
          WHERE session_id = ${'session-target'}
        `
        yield* Effect.promise(() => fs.rm(oldWorkingPath, { recursive: true, force: true }))
        const block = yield* liveSessionAuthorityBlockReason(sql, 'local-user', 'session-target')
        const caller = yield* resolveSessionToolAgentCaller(sql, {
          sessionId: 'session-target',
          runId: 'transient-run-after-handoff',
          workingDirectory: projectPath,
        }).pipe(Effect.either)
        return { response, snapshot: rows[0]?.authority_scope_snapshot_json, block, caller }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome.effect).toBe('session-handed-off')
    expect(decodeSessionAuthoritySnapshot(result.snapshot)).toEqual({
      ...decodeSessionAuthoritySnapshot(originalSnapshot),
      workingPath: projectPath,
    })
    expect(result.block).toBe('authority_changed')
    expect(result.caller._tag).toBe('Left')
  })
})
