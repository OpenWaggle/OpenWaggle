import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { HiveWorkerCleanup } from '../../ports/hive-worker-cleanup'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRepository } from '../../ports/session-control-repository'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { withSessionCommandSerialization } from '../session-command-serialization'
import { executeSessionControlMutation } from '../session-control-command-service'
import { unusedCommandDependencies } from './session-control-command-test-layer'

const WORKER = SessionId('session-deferred-worker')

function layer(settle: () => Effect.Effect<unknown>, cleanups: string[]) {
  return Layer.mergeAll(
    unusedCommandDependencies(),
    Layer.succeed(SessionControlRepository, {
      executeMutation: () =>
        Effect.succeed({
          replayed: false,
          outcome: {
            operation: 'queue-withdraw' as const,
            effect: 'queue-updated' as const,
            sessionId: WORKER,
            queueState: 'running' as const,
            queueRevision: 2,
            followUpIds: [],
            stateRevision: 3,
          },
        }),
    }),
    Layer.succeed(SessionControlIdentityService, {
      nextRunId: Effect.succeed(RunId('run-unused')),
      nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
      nextReportId: Effect.succeed(ReportId('report-unused')),
      nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
      now: Effect.succeed(1_000),
    }),
    Layer.succeed(
      SessionControlRunLifecycleRepository,
      fromPartial({
        settleDeferredWorkerDelegation: () =>
          settle().pipe(
            Effect.as({
              delegationUpdate: {
                delegationId: 'delegation-1',
                parentSessionId: SessionId('queen'),
                state: 'ready_for_review' as const,
              },
            }),
          ),
      }),
    ),
    Layer.succeed(SessionControlRunExecutor, fromPartial({})),
    Layer.succeed(SessionOrchestrationUpdateDeliveryService, fromPartial({})),
    Layer.succeed(
      HiveWorkerCleanup,
      fromPartial({
        // An inline cleanup pass serializes on the Worker like a command does.
        requestReconciliation: (sessionId: string) =>
          withSessionCommandSerialization(
            sessionId,
            Effect.sync(() => {
              cleanups.push(sessionId)
            }),
          ),
      }),
    ),
  )
}

function withdraw(settle: () => Effect.Effect<unknown>, cleanups: string[]) {
  return executeSessionControlMutation({
    callerId: 'gui:local-user',
    request: {
      contractVersion: 2,
      requestId: 'request-withdraw',
      idempotencyKey: 'key-withdraw',
      command: { operation: 'queue-withdraw', sessionId: WORKER, followUpIds: ['held'] },
    },
  }).pipe(Effect.provide(layer(settle, cleanups)), Effect.timeout('2 seconds'))
}

describe('settling a Worker an edit deferred, after the queue change', () => {
  it('requests Hive cleanup once the Worker’s serialization is released', async () => {
    const cleanups: string[] = []
    const response = await Effect.runPromise(withdraw(() => Effect.void, cleanups))
    expect(response.outcome).toMatchObject({ effect: 'queue-updated' })
    expect(cleanups).toEqual([WORKER])
  })

  it('reports the committed queue change even when the deferred settlement fails', async () => {
    const cleanups: string[] = []
    const response = await Effect.runPromise(
      withdraw(() => Effect.die(new Error('database locked')), cleanups),
    )
    expect(response.outcome).toMatchObject({ effect: 'queue-updated' })
    expect(cleanups).toEqual([])
  })
})
