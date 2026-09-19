import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { organizeSession } from '../../application/session-organization-service'
import type {
  PreparedWorkspaceHandoff,
  SessionWorkspaceHandoffServiceShape,
} from '../../ports/session-workspace-handoff-service'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

const request = {
  contractVersion: 2 as const,
  requestId: 'request-handoff',
  idempotencyKey: 'handoff-key',
  command: {
    operation: 'handoff' as const,
    sessionId: 'session-target',
    workspace: { mode: 'existing' as const, workspaceId: 'workspace-existing' },
  },
}

const prepared: PreparedWorkspaceHandoff = {
  transfer: 'deferred-existing',
  workspaceId: 'workspace-existing',
  projectPath: '/project',
  sourceWorkingPath: '/project',
  workingPath: '/project-existing',
  sourceHead: 'source-head',
  snapshotRef: 'refs/openwaggle/source',
  targetSnapshotRef: 'refs/openwaggle/target',
}

describe('completed Workspace handoff cleanup recovery', () => {
  let temporaryRoot = ''

  afterEach(async () => {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('replays retained Git refs and clears cleanup metadata only after release succeeds', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-handoff-cleanup-'))
    let preparation: PreparedWorkspaceHandoff | undefined = prepared
    const complete = vi
      .fn<SessionWorkspaceHandoffServiceShape['complete']>()
      .mockImplementationOnce(() => Effect.die('git ref release failed'))
      .mockImplementation(() => Effect.void)
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'state.sqlite'), {
      prepare: () => Effect.succeed(preparation),
      apply: () => Effect.void,
      rollback: () => Effect.void,
      complete,
    })

    const cleanup = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO workspace_resources (
            id, project_path, kind, working_path, lifecycle_state,
            worktree_branch, worktree_base_ref, worktree_start_from_origin, created_at, updated_at
          ) VALUES (
            ${'workspace-existing'}, ${'/project'}, ${'managed-worktree'},
            ${'/project-existing'}, ${'ready'}, ${'ow/existing'}, ${'source-head'},
            ${0}, ${1000}, ${1000}
          )
        `
        yield* Effect.exit(organizeSession({ callerId: 'local-user', request }))
        const retained = yield* sql<{ readonly cleanup_json: string | null }>`
          SELECT cleanup_json FROM session_operations WHERE idempotency_key = ${'handoff-key'}
        `
        preparation = {
          transfer: 'release-existing-refs',
          projectPath: '/project',
          snapshotRef: 'refs/openwaggle/source',
          targetSnapshotRef: 'refs/openwaggle/target',
        }
        const replay = yield* organizeSession({ callerId: 'local-user', request })
        const cleared = yield* sql<{ readonly cleanup_json: string | null }>`
          SELECT cleanup_json FROM session_operations WHERE idempotency_key = ${'handoff-key'}
        `
        return { retained: retained[0], replay, cleared: cleared[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(cleanup.retained?.cleanup_json).toContain('refs/openwaggle/source')
    expect(cleanup.replay.replayed).toBe(true)
    expect(cleanup.cleared).toEqual({ cleanup_json: null })
    expect(complete).toHaveBeenCalledTimes(2)
  })
})
