import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { installSessionHostEventPublisher } from '../../session-host/session-host-events'
import { installHiveParentWakeHandler } from '../hive-parent-wake-request'
import { coordinateSessionRuns } from '../session-control-run-coordinator'
import { NoSteeringLayer } from './agent-steering-test-layer'

describe('Session Control Run coordinator settlement event', () => {
  // Settlement learns when the Run was seen to end, and clients learn which Run settled and how.
  it.each([
    { name: 'a Run the user started', hiveWake: undefined },
    { name: 'a Hive wake', hiveWake: true as const },
  ])('settles with the terminal event time and names $name it settled', async ({ hiveWake }) => {
    const sessionId = SessionId('session-terminal-event')
    const runId = RunId('run-terminal-event')
    const settleInputs: unknown[] = []
    const published: SessionHostEventPayload[] = []
    const uninstall = installSessionHostEventPublisher((payload) => published.push(payload))
    const layer = Layer.mergeAll(
      Layer.succeed(SessionControlIdentityService, {
        nextRunId: Effect.succeed(RunId('run-next')),
        nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
        nextReportId: Effect.succeed(ReportId('report-unused')),
        nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
        now: Effect.succeed(2000),
      }),
      Layer.succeed(SessionControlRunLifecycleRepository, {
        activate: () =>
          Effect.succeed({
            accepted: true as const,
            stateRevision: 1,
            intent: {
              text: 'Reply with OK.',
              attachmentIds: [],
              callerId: 'local-user',
              acceptedAt: 1000,
              idempotencyKey: 'terminal-event',
              ...(hiveWake ? { hiveWake } : {}),
            },
          }),
        settle: (input) =>
          Effect.sync(() => {
            settleInputs.push(input)
            return { accepted: true, stateRevision: 2 }
          }),
        recoverHostLoss: Effect.succeed([]),
      }),
      Layer.succeed(SessionControlRunExecutor, {
        execute: () =>
          Effect.succeed({
            terminalStatus: 'failed' as const,
            terminalEventAt: 1500,
            failure: { code: 'persist-failed' },
          }),
      }),
      NoSteeringLayer,
      Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
        deliverPendingToActiveRun: () => Effect.succeed(false),
        deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
      }),
    )

    try {
      await Effect.runPromise(
        coordinateSessionRuns({ sessionId, startingRunId: runId }).pipe(Effect.provide(layer)),
      )
    } finally {
      uninstall()
    }

    expect(settleInputs).toEqual([
      expect.objectContaining({ runId, terminalStatus: 'failed', terminalEventAt: 1500 }),
    ])
    expect(published).toContainEqual({
      kind: 'session-state-changed',
      sessionId,
      stateRevision: 2,
      operation: 'run-settled',
      runId,
      terminalStatus: 'failed',
      failureCode: 'persist-failed',
      // A client offers no Retry of the user's last prompt for a failed wake.
      ...(hiveWake ? { hiveWake } : {}),
    })
  })

  it('asks for a wake of an idle parent when a Worker Run’s end recorded an update', async () => {
    const callerId = 'session-agent:queen:run-q'
    const requested: unknown[] = []
    const delivered: string[] = []
    const release = installHiveParentWakeHandler((request) => requested.push(request))
    const layer = Layer.mergeAll(
      Layer.succeed(SessionControlIdentityService, {
        nextRunId: Effect.succeed(RunId('run-next')),
        nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
        nextReportId: Effect.succeed(ReportId('report-unused')),
        nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
        now: Effect.succeed(2000),
      }),
      Layer.succeed(SessionControlRunLifecycleRepository, {
        activate: () =>
          Effect.succeed({
            accepted: true as const,
            stateRevision: 1,
            intent: {
              text: 'Draft the epic.',
              attachmentIds: [],
              callerId,
              acceptedAt: 1000,
              idempotencyKey: 'worker-run',
            },
          }),
        settle: () =>
          Effect.succeed({
            accepted: true,
            stateRevision: 2,
            orchestrationUpdate: {
              updateId: 'update-1',
              parentSessionId: SessionId('queen'),
              workerSessionId: SessionId('worker'),
              delegationId: 'delegation-1',
              sourceRunId: RunId('run-worker'),
              state: 'ready_for_review' as const,
            },
          }),
        recoverHostLoss: Effect.succeed([]),
      }),
      Layer.succeed(SessionControlRunExecutor, {
        execute: () =>
          Effect.succeed({ terminalStatus: 'completed' as const, finalResponse: 'Drafted.' }),
      }),
      NoSteeringLayer,
      Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
        deliverPendingToActiveRun: ({ parentSessionId }) =>
          Effect.sync(() => {
            delivered.push(parentSessionId)
            return false
          }),
        deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
      }),
    )

    try {
      await Effect.runPromise(
        coordinateSessionRuns({
          sessionId: SessionId('worker'),
          startingRunId: RunId('run-worker'),
        }).pipe(Effect.provide(layer)),
      )
    } finally {
      release()
    }

    // A running parent receives the update either way.
    expect(delivered).toEqual(['queen'])
    expect(requested).toContainEqual({ parentSessionId: 'queen' })
  })
})
