import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeSessionQuery, makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

describe('SQLite Delegation conflict query', () => {
  let root: string
  const runtimes: Array<ReturnType<typeof makeSessionQueryRuntime>> = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-conflict-query-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(root, { recursive: true, force: true })
  })

  it('lists exact statuses without leaking outside the caller scope', async () => {
    const runtime = makeSessionQueryRuntime(path.join(root, 'conflicts.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, project_path, title, created_at, updated_at)
          VALUES (${'worker-peer'}, ${'pi-worker-peer'}, ${'/project-b'}, ${'Peer worker'}, ${1}, ${2})
        `
        yield* sql`
          INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
          VALUES (${'worker-peer'}, ${'workspace-a'}, ${1})
        `
        yield* sql`
          INSERT INTO delegation_contracts (
            id, parent_session_id, child_session_id, state,
            current_specification_revision, created_at, updated_at
          ) VALUES (
            ${'delegation-worker-peer'}, ${'queen'}, ${'worker-peer'}, ${'working'}, ${1}, ${1}, ${2}
          )
        `
        yield* sql`
          INSERT INTO delegation_specifications (
            delegation_id, revision, specification_json, authored_by, created_at
          ) VALUES (
            ${'delegation-worker-peer'}, ${1},
            ${'{"objective":"Review migration","deliverables":[],"acceptanceCriteria":[],"resourceReferences":[]}'},
            ${'queen'}, ${1}
          )
        `
        yield* sql`
          INSERT INTO delegation_conflicts (
            id, left_delegation_id, right_delegation_id, kind, evidence_json,
            acknowledged_by, acknowledgement_reason, acknowledged_at, created_at
          ) VALUES (
            ${'conflict-worker'}, ${'delegation-worker'}, ${'delegation-worker-peer'},
            ${'live-overlap'}, ${'{"path":"src/main"}'}, ${'queen'},
            ${'Intentional overlap.'}, ${3}, ${2}
          )
        `
      }),
    )
    const visible = await executeSessionQuery(runtime, {
      operation: 'delegations-conflicts',
      limit: 10,
      delegationId: 'delegation-worker',
      statuses: ['acknowledged'],
    })
    const hidden = await executeSessionQuery(
      runtime,
      { operation: 'delegations-conflicts', limit: 10 },
      {
        profileId: 'profile-b',
        profileName: 'b',
        capabilities: ['delegations:read'],
        scope: { projectPaths: ['/project-b'] },
        authorizationCeiling: 'ask-for-approval',
      },
    )
    const oneSideVisible = await executeSessionQuery(
      runtime,
      { operation: 'delegations-conflicts', limit: 10 },
      {
        profileId: 'profile-a',
        profileName: 'a',
        capabilities: ['delegations:read'],
        scope: { projectPaths: ['/project-a'] },
        authorizationCeiling: 'ask-for-approval',
      },
    )

    expect(visible.outcome).toMatchObject({
      operation: 'delegations-conflicts',
      conflicts: [
        {
          conflictId: 'conflict-worker',
          status: 'acknowledged',
          leftDelegationId: 'delegation-worker',
          rightDelegationId: 'delegation-worker-peer',
          acknowledgementReason: 'Intentional overlap.',
        },
      ],
    })
    expect(hidden.outcome).toMatchObject({ operation: 'delegations-conflicts', conflicts: [] })
    expect(oneSideVisible.outcome).toMatchObject({
      operation: 'delegations-conflicts',
      conflicts: [],
    })
  })
})
