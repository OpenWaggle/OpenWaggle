import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionControlDelegationVerifyCommand } from '@shared/types/session-collaboration'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlDelegationMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionDelegationRepository } from '../../ports/session-delegation-repository'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

function verifyRequest(
  id: string,
  command: SessionControlDelegationVerifyCommand,
): SessionControlDelegationMutationRequest {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: `request-${id}`,
    idempotencyKey: `idempotency-${id}`,
    command,
  }
}

describe('SQLite Delegation verification', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-delegation-verification-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('records reviewer evidence against one exact submission without accepting it', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'verification.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const delegations = yield* SessionDelegationRepository
        const sql = yield* SqlClient.SqlClient
        yield* lifecycle.execute(spawnLifecycleInput())
        yield* delegations.execute({
          callerId: 'worker',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-submit',
            idempotencyKey: 'idempotency-submit',
            command: {
              operation: 'delegation-submit',
              sessionId: 'session-worker',
              delegationId: 'delegation-worker',
              summary: 'Ready.',
              evidence: [],
            },
          },
          now: 3000,
        })
        const workerAttempt = yield* delegations.execute({
          callerId: 'worker',
          request: verifyRequest('worker', {
            operation: 'delegation-verify',
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            submissionRevision: 1,
            outcome: 'passed',
            summary: 'Self verified.',
            evidence: [],
          }),
          now: 4000,
        })
        const verified = yield* delegations.execute({
          callerId: 'reviewer',
          request: verifyRequest('parent', {
            operation: 'delegation-verify',
            sessionId: 'session-parent',
            delegationId: 'delegation-worker',
            submissionRevision: 1,
            outcome: 'passed',
            summary: 'Fresh test run passed.',
            evidence: [
              {
                kind: 'observed-command',
                summary: 'pnpm test passed.',
                reference: 'run:verification-1',
                provenance: { command: 'pnpm test' },
              },
            ],
          }),
          now: 5000,
        })
        const rows = yield* sql<{
          outcome: string
          summary: string
          state: string
          evidence_count: number
        }>`
          SELECT verifications.outcome, verifications.summary, contracts.state,
            COUNT(evidence.ordinal) AS evidence_count
          FROM delegation_verifications AS verifications
          JOIN delegation_contracts AS contracts ON contracts.id = verifications.delegation_id
          LEFT JOIN delegation_verification_evidence AS evidence
            ON evidence.verification_id = verifications.id
          GROUP BY verifications.id
        `
        return { workerAttempt, verified, row: rows[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.workerAttempt.outcome).toMatchObject({
      effect: 'rejected',
      code: 'parent_required',
    })
    expect(result.verified.outcome).toMatchObject({
      effect: 'delegation-verification-recorded',
      submissionRevision: 1,
      verificationOutcome: 'passed',
    })
    expect(result.row).toEqual({
      outcome: 'passed',
      summary: 'Fresh test run passed.',
      state: 'ready_for_review',
      evidence_count: 1,
    })
  })
})
