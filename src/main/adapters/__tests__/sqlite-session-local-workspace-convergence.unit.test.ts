import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  makeSessionLifecycleTestLayer,
  rootLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

let temporaryRoot = ''

describe('SQLite local Workspace lifecycle convergence', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-workspace-convergence-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('converges concurrent first-use local Workspace plans on one canonical resource', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'race.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        const first = rootLifecycleInput('create')
        const input = (suffix: string) => ({
          ...first,
          request: {
            ...first.request,
            requestId: `request-create-${suffix}`,
            idempotencyKey: `idempotency-create-${suffix}`,
            command: {
              ...first.request.command,
              projectPath: '/new-project',
            },
          },
          session: {
            sessionId: `session-create-${suffix}`,
            piSessionId: `pi-create-${suffix}`,
            piSessionFile: `/sessions/create-${suffix}.jsonl`,
          },
          workspacePlan: {
            mode: 'provisioned' as const,
            workspace: {
              id: `workspace-${suffix}`,
              projectPath: '/new-project',
              kind: 'local' as const,
              workingPath: '/new-project',
              lifecycleState: 'ready' as const,
            },
          },
        })
        const responses = yield* Effect.all(
          [repository.execute(input('first')), repository.execute(input('second'))],
          { concurrency: 'unbounded' },
        )
        const sql = yield* SqlClient.SqlClient
        const workspaces = yield* sql<{ readonly id: string }>`
          SELECT id FROM workspace_resources
          WHERE project_path = ${'/new-project'} AND working_path = ${'/new-project'}
        `
        const bindings = yield* sql<{ readonly workspace_id: string }>`
          SELECT workspace_id FROM session_workspace_bindings
          WHERE session_id IN (${'session-create-first'}, ${'session-create-second'})
          ORDER BY session_id
        `
        return { responses, workspaces, bindings }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.workspaces).toHaveLength(1)
    const workspaceId = result.workspaces[0]?.id
    expect(workspaceId).toBeDefined()
    expect(result.bindings).toEqual([{ workspace_id: workspaceId }, { workspace_id: workspaceId }])
    expect(result.responses).toHaveLength(2)
    for (const response of result.responses) {
      expect(response.outcome).toMatchObject({ effect: 'created-root', workspaceId })
    }
  })
})
