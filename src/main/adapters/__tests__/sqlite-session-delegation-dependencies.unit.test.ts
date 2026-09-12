import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type {
  SessionControlDelegationDependencyCommand,
  SessionControlDelegationSubmitCommand,
} from '@shared/types/session-control'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionDelegationRepository } from '../../ports/session-delegation-repository'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

function request(
  id: string,
  command: SessionControlDelegationDependencyCommand | SessionControlDelegationSubmitCommand,
) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: `request-${id}`,
    idempotencyKey: `idempotency-${id}`,
    command,
  }
}

function insertPrerequisite(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO sessions (
        id, pi_session_id, project_path, title, archived, created_at, updated_at
      ) VALUES (
        ${'session-prerequisite'}, ${'pi-prerequisite'}, ${'/project'},
        ${'Prerequisite'}, ${0}, ${2}, ${2}
      )
    `
    yield* sql`
      INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
      VALUES (${'session-prerequisite'}, ${'workspace-parent'}, ${2})
    `
    yield* sql`
      INSERT INTO delegation_contracts (
        id, parent_session_id, child_session_id, state,
        current_specification_revision, created_at, updated_at
      ) VALUES (
        ${'delegation-prerequisite'}, ${'session-parent'}, ${'session-prerequisite'},
        ${'working'}, ${1}, ${2}, ${2}
      )
    `
    yield* sql`
      INSERT INTO delegation_specifications (
        delegation_id, revision, specification_json, authored_by, created_at
      ) VALUES (
        ${'delegation-prerequisite'}, ${1},
        ${JSON.stringify({
          objective: 'Prepare the schema.',
          deliverables: [],
          acceptanceCriteria: [],
          dependencies: [],
          resourceReferences: [],
        })},
        ${'session-parent'}, ${2}
      )
    `
  })
}

function dependencyCommand(input: {
  readonly delegationId: string
  readonly dependencyDelegationId: string
  readonly action: 'add' | 'remove'
}): SessionControlDelegationDependencyCommand {
  return {
    operation: 'delegation-dependency',
    sessionId: 'session-parent',
    delegationId: input.delegationId,
    action: input.action,
    dependencyDelegationId: input.dependencyDelegationId,
    requiredState: 'accepted',
    reason: `${input.action} prerequisite`,
  }
}

describe('SQLite Delegation dependencies', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-delegation-dependencies-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('revises specifications, requests post-submission revision, and rejects cycles', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'dependencies.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const delegations = yield* SessionDelegationRepository
        const sql = yield* SqlClient.SqlClient
        yield* lifecycle.execute(spawnLifecycleInput())
        yield* insertPrerequisite(sql)
        yield* delegations.execute({
          callerId: 'worker',
          request: request('submit', {
            operation: 'delegation-submit',
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            summary: 'Initial result.',
            evidence: [],
          }),
          now: 3000,
        })
        const added = yield* delegations.execute({
          callerId: 'parent',
          request: request(
            'add',
            dependencyCommand({
              delegationId: 'delegation-worker',
              dependencyDelegationId: 'delegation-prerequisite',
              action: 'add',
            }),
          ),
          now: 4000,
        })
        const cycle = yield* delegations.execute({
          callerId: 'parent',
          request: request(
            'cycle',
            dependencyCommand({
              delegationId: 'delegation-prerequisite',
              dependencyDelegationId: 'delegation-worker',
              action: 'add',
            }),
          ),
          now: 5000,
        })
        const removed = yield* delegations.execute({
          callerId: 'parent',
          request: request(
            'remove',
            dependencyCommand({
              delegationId: 'delegation-worker',
              dependencyDelegationId: 'delegation-prerequisite',
              action: 'remove',
            }),
          ),
          now: 6000,
        })
        const specifications = yield* sql<{
          readonly revision: number
          readonly specification_json: string
        }>`
          SELECT revision, specification_json FROM delegation_specifications
          WHERE delegation_id = ${'delegation-worker'} ORDER BY revision
        `
        return { added, cycle, removed, specifications }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.added.outcome).toMatchObject({
      effect: 'delegation-dependencies-updated',
      delegationState: 'revision_requested',
      specificationRevision: 2,
      dependencyCount: 1,
    })
    expect(result.cycle.outcome).toMatchObject({
      effect: 'rejected',
      code: 'delegation_dependency_invalid',
    })
    expect(result.removed.outcome).toMatchObject({
      specificationRevision: 3,
      dependencyCount: 0,
    })
    expect(result.specifications.map((row) => JSON.parse(row.specification_json))).toMatchObject([
      { dependencies: [] },
      { dependencies: [{ delegationId: 'delegation-prerequisite', requiredState: 'accepted' }] },
      { dependencies: [] },
    ])
  })
})
