import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId, WorkspaceId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecyclePreparationService } from '../../ports/session-lifecycle-preparation-service'
import { makeLifecyclePreparationLayer } from './session-lifecycle-preparation-test-support'

const REVIEWER_SNAPSHOT = JSON.stringify({
  schemaVersion: 1,
  name: 'reviewer',
  description: 'Reviews changes',
  instructions: 'Review only.',
  sourcePath: '/project/.openwaggle/agents/reviewer.md',
  scope: 'project',
  contentDigest: 'a'.repeat(64),
  tools: ['read_file'],
})

describe('Session lifecycle Agent definition inheritance', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-launch-role-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('seeds an internal launch without inheriting the initiating Agent definition', async () => {
    const layer = makeLifecyclePreparationLayer(path.join(temporaryRoot, 'launch.sqlite'), [])
    const prepared = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_execution_profiles
          SET profile_json = ${'{"modelId":"provider/reviewer","thinkingLevel":"high","agentDefinitionName":"reviewer","tools":["read_file"]}'},
            resolved_agent_snapshot_json = ${REVIEWER_SNAPSHOT}
          WHERE session_id = ${'session-parent'}
        `
        const service = yield* SessionLifecyclePreparationService
        return yield* service.prepare({
          callerId: 'session-agent:session-parent:run-parent',
          identities: {
            sessionId: SessionId('session-independent'),
            workspaceId: WorkspaceId('workspace-independent'),
          },
          request: {
            contractVersion: 2,
            requestId: 'request-independent-launch',
            idempotencyKey: 'independent-launch',
            command: {
              operation: 'launch',
              projectPath: '/project',
              workspace: { mode: 'local' },
              objective: 'Implement the feature.',
              attachmentIds: [],
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(prepared.executionSnapshot.profile).toMatchObject({
      modelId: 'provider/reviewer',
      thinkingLevel: 'high',
      tools: ['read_file'],
    })
    expect(prepared.executionSnapshot.profile).not.toHaveProperty('agentDefinitionName')
    expect(prepared.executionSnapshot.resolvedAgentSnapshot).toBeUndefined()
  })
})
