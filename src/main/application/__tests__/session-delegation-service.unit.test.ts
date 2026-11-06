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
import { installHiveParentWakeHandler } from '../hive-parent-wake-request'
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
        delegationStateOf: () => Effect.die('unused'),
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

  function submitByCaller(callerId: string) {
    const wakes: string[] = []
    const delivered: string[] = []
    const release = installHiveParentWakeHandler((request) => wakes.push(request.parentSessionId))
    const request: SessionControlDelegationMutationRequest = {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-submit',
      idempotencyKey: 'idempotency-submit',
      command: {
        operation: 'delegation-submit',
        sessionId: 'worker-1',
        delegationId: 'delegation-1',
        summary: 'Drafted the epics.',
        evidence: [],
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
              operation: 'delegation-submit',
              effect: 'delegation-updated',
              sessionId: 'worker-1',
              delegationId: 'delegation-1',
              parentSessionId: 'queen',
              workerSessionId: 'worker-1',
              delegationState: 'ready_for_review',
              specificationRevision: 1,
              submissionRevision: 1,
            },
          }),
        delegationStateOf: () => Effect.die('unused'),
      }),
      Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
        deliverPendingToActiveRun: ({ parentSessionId }) =>
          Effect.sync(() => {
            delivered.push(parentSessionId)
            return false
          }),
        deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
      }),
    )
    return Effect.runPromise(
      executeSessionDelegationMutation({ callerId, request }).pipe(
        Effect.provide(layer),
        Effect.ensuring(Effect.sync(release)),
        Effect.as({ wakes, delivered }),
      ),
    )
  }

  it('wakes the parent for a result the Worker’s own agent or the desktop user submitted', async () => {
    expect(await submitByCaller('session-agent:worker-1:run-w')).toEqual({
      wakes: ['queen'],
      delivered: ['queen'],
    })
    expect(await submitByCaller('local-user')).toEqual({ wakes: ['queen'], delivered: ['queen'] })
  })

  it('never lets a CLI profile that may only contribute start a Run on the parent', async () => {
    // It reaches a running parent, and waits for the parent's next Run otherwise.
    expect(await submitByCaller('profile:contributor')).toEqual({
      wakes: [],
      delivered: ['queen'],
    })
    expect(await submitByCaller('session-agent:stranger:run-s')).toEqual({
      wakes: [],
      delivered: ['queen'],
    })
  })
})
