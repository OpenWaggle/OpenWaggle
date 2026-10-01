import { RunId, SessionId } from '@shared/types/brand'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationRequest,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { HiveWorkerCleanup } from '../../ports/hive-worker-cleanup'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { installSessionHostEventPublisher } from '../../session-host/session-host-events'
import { settleDeferredWorkerDelegationAfterQueueChange } from '../follow-up-edit-worker-settlement'

const WITHDRAW: SessionControlMutationRequest = {
  contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
  requestId: 'request-1',
  idempotencyKey: 'key-1',
  command: { operation: 'queue-withdraw', sessionId: 'worker', followUpIds: ['held'] },
}

function response(
  outcome: SessionControlMutationResponse['outcome'],
): SessionControlMutationResponse {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: 'request-1',
    idempotencyKey: 'key-1',
    replayed: false,
    outcome,
  }
}

const UPDATED = response({
  operation: 'queue-withdraw',
  effect: 'queue-updated',
  sessionId: 'worker',
  queueState: 'running',
  queueRevision: 5,
  followUpIds: [],
  stateRevision: 9,
})

function run(input: {
  readonly request: SessionControlMutationRequest
  readonly response: SessionControlMutationResponse
}) {
  const calls: string[] = []
  const published: SessionHostEventPayload[] = []
  const layer = Layer.mergeAll(
    Layer.succeed(
      SessionControlRunLifecycleRepository,
      fromPartial({
        settleDeferredWorkerDelegation: () =>
          Effect.sync(() => {
            calls.push('settle')
            return {
              delegationUpdate: {
                delegationId: 'delegation-1',
                parentSessionId: SessionId('queen'),
                state: 'ready_for_review' as const,
              },
              orchestrationUpdate: {
                updateId: 'update-1',
                parentSessionId: SessionId('queen'),
                workerSessionId: SessionId('worker'),
                delegationId: 'delegation-1',
                sourceRunId: RunId('run-1'),
                state: 'ready_for_review' as const,
              },
            }
          }),
      }),
    ),
    Layer.succeed(
      SessionOrchestrationUpdateDeliveryService,
      fromPartial({
        deliverPendingToActiveRun: (delivery: { readonly parentSessionId: string }) =>
          Effect.sync(() => {
            calls.push(`deliver:${delivery.parentSessionId}`)
          }),
      }),
    ),
    Layer.succeed(
      HiveWorkerCleanup,
      fromPartial({
        requestReconciliation: (sessionId: string) =>
          Effect.sync(() => {
            calls.push(`cleanup:${sessionId}`)
          }),
      }),
    ),
  )
  const uninstall = installSessionHostEventPublisher((payload) => published.push(payload))
  return Effect.runPromise(
    settleDeferredWorkerDelegationAfterQueueChange(input.request, input.response).pipe(
      Effect.provide(layer),
      Effect.as({ calls, published }),
      Effect.ensuring(Effect.sync(uninstall)),
    ),
  )
}

describe('settling a Worker whose held Follow-up ended without a Run', () => {
  it('publishes and delivers the deferred Delegation update after a queue change', async () => {
    const result = await run({ request: WITHDRAW, response: UPDATED })
    expect(result.calls).toEqual(['settle', 'deliver:queen', 'cleanup:worker'])
    expect(result.published).toEqual([
      { kind: 'session-list-changed', sessionId: 'queen', change: 'updated' },
    ])
  })

  it('leaves settlement to the Run a queue change started, and ignores rejected changes', async () => {
    const started = await run({
      request: WITHDRAW,
      response: response({
        operation: 'queue-withdraw',
        effect: 'started-run',
        sessionId: 'worker',
        runId: 'run-2',
        followUpId: 'next',
        queueRevision: 5,
        stateRevision: 9,
      }),
    })
    const rejected = await run({
      request: WITHDRAW,
      response: response({
        operation: 'queue-withdraw',
        effect: 'rejected',
        sessionId: 'worker',
        code: 'queue_revision_changed',
      }),
    })
    expect(started.calls).toEqual([])
    expect(rejected.calls).toEqual([])
  })
})
