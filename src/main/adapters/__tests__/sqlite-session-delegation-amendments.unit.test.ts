import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlDelegationMutationRequest,
} from '@shared/types/session-control'
import type { DelegationSpecificationInput } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionDelegationRepository } from '../../ports/session-delegation-repository'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

const revisedSpecification: DelegationSpecificationInput = {
  objective: 'Implement and document the verifier.',
  deliverables: ['Implementation', 'Tests', 'Documentation'],
  acceptanceCriteria: ['Corrupt targets fail', 'Usage is documented'],
  dependencies: [],
  resourceReferences: ['docs/verifier.md'],
}

function request(id: string, command: SessionControlDelegationMutationRequest['command']) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: `request-${id}`,
    idempotencyKey: `idempotency-${id}`,
    command,
  }
}

describe('SQLite Delegation amendments', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-delegation-amendments-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('keeps Worker proposals separate until the parent applies an exact revision', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'amendments.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const delegations = yield* SessionDelegationRepository
        const sql = yield* SqlClient.SqlClient
        yield* lifecycle.execute(spawnLifecycleInput())
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
        const proposed = yield* delegations.execute({
          callerId: 'worker',
          request: request('propose', {
            operation: 'delegation-propose-amendment',
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            baseSpecificationRevision: 1,
            specification: revisedSpecification,
            reason: 'Documentation was added to scope.',
          }),
          now: 4000,
        })
        if (proposed.outcome.effect !== 'delegation-amendment-proposed') {
          throw new Error('Expected an amendment proposal.')
        }
        const mismatch = yield* delegations.execute({
          callerId: 'parent',
          request: request('mismatch', {
            operation: 'delegation-amend',
            sessionId: 'session-parent',
            delegationId: 'delegation-worker',
            expectedSpecificationRevision: 1,
            specification: { ...revisedSpecification, objective: 'Different objective.' },
            reason: 'Apply proposal.',
            proposalId: proposed.outcome.proposalId,
          }),
          now: 5000,
        })
        const applied = yield* delegations.execute({
          callerId: 'parent',
          request: request('apply', {
            operation: 'delegation-amend',
            sessionId: 'session-parent',
            delegationId: 'delegation-worker',
            expectedSpecificationRevision: 1,
            specification: revisedSpecification,
            reason: 'Apply the Worker proposal.',
            proposalId: proposed.outcome.proposalId,
          }),
          now: 6000,
        })
        const proposals = yield* sql<{
          readonly status: string
          readonly applied_specification_revision: number | null
        }>`
          SELECT status, applied_specification_revision FROM delegation_amendment_proposals
        `
        const specificationUpdates = yield* sql<{
          readonly worker_session_id: string
          readonly specification_revision: number
          readonly status: string
        }>`
          SELECT worker_session_id, specification_revision, status
          FROM delegation_specification_updates
        `
        return { proposed, mismatch, applied, proposals, specificationUpdates }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.proposed.outcome).toMatchObject({
      effect: 'delegation-amendment-proposed',
      baseSpecificationRevision: 1,
    })
    expect(result.mismatch.outcome).toMatchObject({
      effect: 'rejected',
      code: 'delegation_amendment_proposal_mismatch',
    })
    expect(result.applied.outcome).toMatchObject({
      effect: 'delegation-specification-amended',
      delegationState: 'revision_requested',
      specificationRevision: 2,
    })
    expect(result.proposals).toEqual([{ status: 'applied', applied_specification_revision: 2 }])
    expect(result.specificationUpdates).toEqual([
      { worker_session_id: 'session-worker', specification_revision: 2, status: 'pending' },
    ])
  })
})
