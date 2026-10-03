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
import { coordinateSessionRuns } from '../session-control-run-coordinator'
import { NoSteeringLayer } from './agent-steering-test-layer'

describe('Session Control Run coordinator settlement event', () => {
  // Settlement learns when the Run was seen to end, and clients learn which Run settled and how.
  it('settles with the terminal event time and names the Run it settled', async () => {
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
    })
  })
})
