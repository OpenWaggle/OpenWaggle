import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
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
  command:
    | {
        readonly operation: 'delegation-submit'
        readonly sessionId: string
        readonly delegationId: string
        readonly summary: string
        readonly evidence: readonly []
      }
    | {
        readonly operation: 'delegation-request-revision'
        readonly sessionId: string
        readonly delegationId: string
        readonly submissionRevision: number
        readonly feedback: string
        readonly revisedSpecification?: {
          readonly objective: string
          readonly deliverables: readonly string[]
          readonly acceptanceCriteria: readonly string[]
          readonly resourceReferences: readonly string[]
        }
      }
    | {
        readonly operation: 'delegation-accept'
        readonly sessionId: string
        readonly delegationId: string
        readonly submissionRevision: number
      }
    | {
        readonly operation: 'delegation-reopen' | 'delegation-cancel'
        readonly sessionId: string
        readonly delegationId: string
        readonly reason: string
      }
    | {
        readonly operation: 'delegation-state'
        readonly sessionId: string
        readonly delegationId: string
        readonly state: 'working' | 'waiting' | 'needs_attention'
        readonly reason: string
      },
) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: `request-${id}`,
    idempotencyKey: `idempotency-${id}`,
    command,
  } as const
}

describe('SQLite Delegation repository', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-delegation-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('records immutable submissions, revision review, and acceptance against exact revisions', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'delegation.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const delegations = yield* SessionDelegationRepository
        const sql = yield* SqlClient.SqlClient
        yield* lifecycle.execute(spawnLifecycleInput())
        const waiting = yield* delegations.execute({
          callerId: 'session-agent:session-worker:run-worker',
          request: request('waiting', {
            operation: 'delegation-state',
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            state: 'waiting',
            reason: 'Waiting for the fixture.',
          }),
          now: 2500,
        })
        const first = yield* delegations.execute({
          callerId: 'session-agent:session-worker:run-worker',
          request: request('submit-1', {
            operation: 'delegation-submit',
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            summary: 'Initial implementation.',
            evidence: [],
          }),
          now: 3000,
        })
        const revision = yield* delegations.execute({
          callerId: 'session-agent:session-parent:run-parent',
          request: request('revision', {
            operation: 'delegation-request-revision',
            sessionId: 'session-parent',
            delegationId: 'delegation-worker',
            submissionRevision: 1,
            feedback: 'Add corrupt-input coverage.',
            revisedSpecification: {
              objective: 'Implement the verifier with corrupt-input coverage.',
              deliverables: ['Implementation', 'Tests'],
              acceptanceCriteria: ['Corrupt targets fail safely'],
              resourceReferences: [],
            },
          }),
          now: 4000,
        })
        const second = yield* delegations.execute({
          callerId: 'session-agent:session-worker:run-worker-2',
          request: request('submit-2', {
            operation: 'delegation-submit',
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            summary: 'Added corrupt-input coverage.',
            evidence: [],
          }),
          now: 5000,
        })
        const accepted = yield* delegations.execute({
          callerId: 'session-agent:session-parent:run-parent',
          request: request('accept', {
            operation: 'delegation-accept',
            sessionId: 'session-parent',
            delegationId: 'delegation-worker',
            submissionRevision: 2,
          }),
          now: 6000,
        })
        const reopened = yield* delegations.execute({
          callerId: 'session-agent:session-parent:run-parent',
          request: request('reopen', {
            operation: 'delegation-reopen',
            sessionId: 'session-parent',
            delegationId: 'delegation-worker',
            reason: 'The release target changed.',
          }),
          now: 7000,
        })
        const third = yield* delegations.execute({
          callerId: 'session-agent:session-worker:run-worker-3',
          request: request('submit-3', {
            operation: 'delegation-submit',
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            summary: 'Updated for the new release target.',
            evidence: [],
          }),
          now: 8000,
        })
        const cancelled = yield* delegations.execute({
          callerId: 'session-agent:session-parent:run-parent',
          request: request('cancel', {
            operation: 'delegation-cancel',
            sessionId: 'session-parent',
            delegationId: 'delegation-worker',
            reason: 'The release was withdrawn.',
          }),
          now: 9000,
        })
        const rows = yield* sql<{
          state: string
          current_specification_revision: number
        }>`
          SELECT state, current_specification_revision FROM delegation_contracts
          WHERE id = ${'delegation-worker'}
        `
        const transitions = yield* sql<{
          from_state: string
          to_state: string
          reason: string
        }>`
          SELECT from_state, to_state, reason FROM delegation_state_transitions
          WHERE delegation_id = ${'delegation-worker'} ORDER BY id
        `
        return {
          first,
          waiting,
          revision,
          second,
          accepted,
          reopened,
          third,
          cancelled,
          row: rows[0],
          transitions,
        }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.first.outcome).toMatchObject({
      effect: 'delegation-updated',
      delegationState: 'ready_for_review',
      submissionRevision: 1,
    })
    expect(result.waiting.outcome).toMatchObject({ delegationState: 'waiting' })
    expect(result.revision.outcome).toMatchObject({
      delegationState: 'revision_requested',
      specificationRevision: 2,
    })
    expect(result.second.outcome).toMatchObject({
      delegationState: 'ready_for_review',
      submissionRevision: 2,
      specificationRevision: 2,
    })
    expect(result.accepted.outcome).toMatchObject({ delegationState: 'accepted' })
    expect(result.reopened.outcome).toMatchObject({ delegationState: 'revision_requested' })
    expect(result.third.outcome).toMatchObject({
      delegationState: 'ready_for_review',
      submissionRevision: 3,
    })
    expect(result.cancelled.outcome).toMatchObject({ delegationState: 'cancelled' })
    expect(result.row).toEqual({ state: 'cancelled', current_specification_revision: 2 })
    expect(result.transitions).toEqual([
      {
        from_state: 'working',
        to_state: 'waiting',
        reason: 'Waiting for the fixture.',
      },
      {
        from_state: 'accepted',
        to_state: 'revision_requested',
        reason: 'The release target changed.',
      },
      {
        from_state: 'ready_for_review',
        to_state: 'cancelled',
        reason: 'The release was withdrawn.',
      },
    ])
  })

  it('rejects review from the Worker and stale submission acceptance', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'authorization.db'))
    const outcomes = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const delegations = yield* SessionDelegationRepository
        yield* lifecycle.execute(spawnLifecycleInput())
        yield* delegations.execute({
          callerId: 'worker',
          request: request('submit', {
            operation: 'delegation-submit',
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            summary: 'Ready.',
            evidence: [],
          }),
          now: 3000,
        })
        const workerReview = yield* delegations.execute({
          callerId: 'worker',
          request: request('worker-review', {
            operation: 'delegation-accept',
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            submissionRevision: 1,
          }),
          now: 4000,
        })
        const stale = yield* delegations.execute({
          callerId: 'parent',
          request: request('stale', {
            operation: 'delegation-accept',
            sessionId: 'session-parent',
            delegationId: 'delegation-worker',
            submissionRevision: 2,
          }),
          now: 5000,
        })
        return [workerReview.outcome, stale.outcome]
      }).pipe(Effect.provide(layer)),
    )

    expect(outcomes).toEqual([
      expect.objectContaining({ effect: 'rejected', code: 'parent_required' }),
      expect.objectContaining({ effect: 'rejected', code: 'submission_revision_stale' }),
    ])
  })
})
