import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { DelegationScopeClaimInput } from '@shared/types/session-collaboration'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionDelegationRepository } from '../../ports/session-delegation-repository'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

function claimRequest(
  id: string,
  input: {
    readonly sessionId: string
    readonly delegationId: string
    readonly claims: readonly DelegationScopeClaimInput[]
    readonly reason: string
  },
) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: `request-${id}`,
    idempotencyKey: `idempotency-${id}`,
    command: { operation: 'delegation-claim' as const, ...input },
  }
}

function acknowledgementRequest(conflictId: string) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: 'request-acknowledge',
    idempotencyKey: 'idempotency-acknowledge',
    command: {
      operation: 'delegation-conflict-acknowledge' as const,
      sessionId: 'session-parent',
      delegationId: 'delegation-worker-two',
      conflictId,
      reason: 'The Workers have coordinated their edits.',
    },
  }
}

function insertSecondWorker(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO sessions (
        id, pi_session_id, project_path, title, archived, created_at, updated_at
      ) VALUES (
        ${'session-worker-two'}, ${'pi-worker-two'}, ${'/project'}, ${'Worker two'},
        ${0}, ${2}, ${2}
      )
    `
    yield* sql`
      INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
      VALUES (${'session-worker-two'}, ${'workspace-parent'}, ${2})
    `
    yield* sql`
      INSERT INTO delegation_contracts (
        id, parent_session_id, child_session_id, state,
        current_specification_revision, created_at, updated_at
      ) VALUES (
        ${'delegation-worker-two'}, ${'session-parent'}, ${'session-worker-two'},
        ${'working'}, ${1}, ${2}, ${2}
      )
    `
  })
}

function moveSecondWorkerToWorktree(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO workspace_resources (
        id, project_path, kind, working_path, lifecycle_state,
        worktree_start_from_origin, created_at, updated_at
      ) VALUES (
        ${'workspace-two'}, ${'/project'}, ${'managed-worktree'}, ${'/project-worker-two'},
        ${'ready'}, ${0}, ${5}, ${5}
      )
    `
    yield* sql`
      UPDATE session_workspace_bindings SET workspace_id = ${'workspace-two'}
      WHERE session_id = ${'session-worker-two'}
    `
  })
}

describe('SQLite Delegation scope claims', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-delegation-claims-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('normalizes revisions and records live and merge overlap evidence', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'claims.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const delegations = yield* SessionDelegationRepository
        const sql = yield* SqlClient.SqlClient
        yield* lifecycle.execute(spawnLifecycleInput())
        yield* insertSecondWorker(sql)
        const first = yield* delegations.execute({
          callerId: 'worker-one',
          request: claimRequest('one', {
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            claims: [
              { access: 'write', target: { type: 'workspace-tree', path: './src' } },
              { access: 'read', target: { type: 'workspace-file', path: 'README.md' } },
            ],
            reason: 'Starting the implementation.',
          }),
          now: 3000,
        })
        const live = yield* delegations.execute({
          callerId: 'worker-two',
          request: claimRequest('live', {
            sessionId: 'session-worker-two',
            delegationId: 'delegation-worker-two',
            claims: [{ access: 'write', target: { type: 'workspace-file', path: 'src/check.ts' } }],
            reason: 'Editing the overlapping verifier.',
          }),
          now: 4000,
        })
        if (live.outcome.effect !== 'delegation-claims-updated' || !live.outcome.conflictIds[0]) {
          throw new Error('Expected one live overlap.')
        }
        const acknowledged = yield* delegations.execute({
          callerId: 'parent',
          request: acknowledgementRequest(live.outcome.conflictIds[0]),
          now: 4500,
        })
        yield* moveSecondWorkerToWorktree(sql)
        const merge = yield* delegations.execute({
          callerId: 'worker-two',
          request: claimRequest('merge', {
            sessionId: 'session-worker-two',
            delegationId: 'delegation-worker-two',
            claims: [{ access: 'write', target: { type: 'workspace-file', path: 'src/check.ts' } }],
            reason: 'Continuing in an isolated worktree.',
          }),
          now: 5000,
        })
        const invalid = yield* delegations.execute({
          callerId: 'worker-one',
          request: claimRequest('invalid', {
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            claims: [{ access: 'write', target: { type: 'workspace-tree', path: '../outside' } }],
            reason: 'Invalid claim.',
          }),
          now: 6000,
        })
        const cleared = yield* delegations.execute({
          callerId: 'worker-two',
          request: claimRequest('clear', {
            sessionId: 'session-worker-two',
            delegationId: 'delegation-worker-two',
            claims: [],
            reason: 'No longer touching shared scope.',
          }),
          now: 7000,
        })
        const claims = yield* sql<{
          readonly delegation_id: string
          readonly revision: number
          readonly target_kind: string
          readonly target_value: string
        }>`
          SELECT delegation_id, revision, target_kind, target_value
          FROM delegation_scope_claims ORDER BY delegation_id, revision, ordinal
        `
        const conflicts = yield* sql<{
          readonly kind: string
          readonly resolved_at: number | null
        }>`
          SELECT kind, resolved_at FROM delegation_conflicts ORDER BY created_at
        `
        const acknowledgements = yield* sql<{ readonly reason: string }>`
          SELECT reason FROM delegation_conflict_acknowledgements ORDER BY id
        `
        return {
          first,
          live,
          acknowledged,
          merge,
          invalid,
          cleared,
          claims,
          conflicts,
          acknowledgements,
        }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.first.outcome).toMatchObject({ claimRevision: 1, conflictIds: [] })
    expect(result.live.outcome).toMatchObject({ claimRevision: 1 })
    if (result.live.outcome.effect === 'delegation-claims-updated') {
      expect(result.live.outcome.conflictIds).toHaveLength(1)
    }
    expect(result.acknowledged.outcome).toMatchObject({
      effect: 'delegation-conflict-acknowledged',
      acknowledgedAt: 4500,
    })
    expect(result.merge.outcome).toMatchObject({ claimRevision: 2 })
    expect(result.invalid.outcome).toMatchObject({
      effect: 'rejected',
      code: 'claim_target_invalid',
    })
    expect(result.cleared.outcome).toMatchObject({ claimRevision: 3, conflictIds: [] })
    expect(result.claims).toHaveLength(4)
    expect(result.claims[0]).toMatchObject({ target_kind: 'workspace-tree', target_value: 'src' })
    expect(result.conflicts).toEqual([
      { kind: 'live-overlap', resolved_at: 5000 },
      { kind: 'merge-overlap', resolved_at: 7000 },
    ])
    expect(result.acknowledgements).toEqual([
      { reason: 'The Workers have coordinated their edits.' },
    ])
  })
})
