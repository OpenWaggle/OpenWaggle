import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import { decodeSessionAuthoritySnapshot } from '../../session-host/session-authority-snapshot'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

describe('SQLite Session lifecycle authority', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-authority-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('normalizes a local Session agent scope to its new pending Worker Workspace', async () => {
    const projectPath = path.join(temporaryRoot, 'spawn-project')
    const parentWorkingPath = path.join(temporaryRoot, 'parent-worktree')
    const childPlannedPath = `pending://workspace-worker-new`
    await Promise.all([fs.mkdir(projectPath), fs.mkdir(parentWorkingPath)])
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'spawn-authority.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE sessions SET project_path = ${projectPath} WHERE id = ${'session-parent'}`
        yield* sql`
          UPDATE workspace_resources
          SET project_path = ${projectPath}, working_path = ${parentWorkingPath}
          WHERE id = ${'workspace-parent'}
        `
        const repository = yield* SessionLifecycleRepository
        const base = spawnLifecycleInput()
        const response = yield* repository.execute({
          ...base,
          callerId: 'session-agent:session-parent:run-parent',
          initiatingWorkingDirectory: parentWorkingPath,
          callerAuthorityScope: {
            projectPaths: [projectPath],
            exportRoots: [parentWorkingPath],
            attachmentRoots: [parentWorkingPath],
          },
          request: {
            ...base.request,
            command: {
              ...base.request.command,
              workspace: { mode: 'new-worktree', baseRef: 'main' },
            },
          },
          workspacePlan: {
            mode: 'provisioned',
            workspace: {
              id: 'workspace-worker-new',
              projectPath,
              kind: 'managed-worktree',
              workingPath: childPlannedPath,
              lifecycleState: 'pending',
              worktreeBaseRef: 'main',
            },
          },
        })
        const rows = yield* sql<{ readonly authority_scope_snapshot_json: string }>`
          SELECT authority_scope_snapshot_json FROM session_execution_profiles
          WHERE session_id = ${'session-worker'}
        `
        return { response, snapshot: rows[0]?.authority_scope_snapshot_json }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({
      effect: 'spawned-worker',
      workspaceId: 'workspace-worker-new',
    })
    expect(decodeSessionAuthoritySnapshot(result.snapshot)).toEqual({
      scope: {
        projectPaths: [projectPath],
        exportRoots: [childPlannedPath],
        attachmentRoots: [childPlannedPath],
      },
      projectPath,
      workingPath: childPlannedPath,
    })
  })
})
