import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlDelegationMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionDelegationRepository } from '../../ports/session-delegation-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { executeSessionDelegationMutation } from '../session-delegation-service'

describe('Session Delegation service', () => {
  it('offers a committed specification revision to an active Worker', async () => {
    const delivered: string[] = []
    const request: SessionControlDelegationMutationRequest = {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-amend',
      idempotencyKey: 'idempotency-amend',
      command: {
        operation: 'delegation-amend',
        sessionId: 'queen',
        delegationId: 'delegation-1',
        expectedSpecificationRevision: 1,
        specification: {
          objective: 'Expanded objective.',
          deliverables: [],
          acceptanceCriteria: [],
          dependencies: [],
          resourceReferences: [],
        },
        reason: 'Scope expanded.',
      },
    }
    const layer = Layer.mergeAll(
      Layer.succeed(SessionControlIdentityService, {
        now: Effect.succeed(1000),
        nextRunId: Effect.die('unused'),
        nextFollowUpId: Effect.die('unused'),
        nextReportId: Effect.die('unused'),
        nextReportCorrelationId: Effect.die('unused'),
      }),
      Layer.succeed(SessionDelegationRepository, {
        execute: () =>
          Effect.succeed({
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: request.requestId,
            idempotencyKey: request.idempotencyKey,
            replayed: false,
            outcome: {
              operation: 'delegation-amend',
              effect: 'delegation-specification-amended',
              sessionId: 'queen',
              delegationId: 'delegation-1',
              delegationState: 'working',
              specificationRevision: 2,
              workerSessionId: 'worker-1',
            },
          }),
      }),
      Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
        deliverPendingToActiveRun: () => Effect.succeed(false),
        deliverPendingSpecificationsToActiveRun: ({ workerSessionId }) =>
          Effect.sync(() => {
            delivered.push(workerSessionId)
            return true
          }),
      }),
    )

    const response = await Effect.runPromise(
      executeSessionDelegationMutation({ callerId: 'parent-agent', request }).pipe(
        Effect.provide(layer),
      ),
    )

    expect(response.outcome).toMatchObject({ effect: 'delegation-specification-amended' })
    expect(delivered).toEqual(['worker-1'])
  })
})
