import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { UndeliveredSteer } from '../../domain/session-control/undelivered-steering'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import {
  SessionControlRunLifecycleRepository,
  type SessionControlRunLifecycleRepositoryShape,
} from '../../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { installSessionHostEventPublisher } from '../../session-host/session-host-events'
import { coordinateSessionRuns } from '../session-control-run-coordinator'

type SettleInput = Parameters<SessionControlRunLifecycleRepositoryShape['settle']>[0]

describe('Session Control Run coordinator Undelivered steering messages', () => {
  it('settles a stopped Run with the steers it ended without incorporating', async () => {
    const sessionId = SessionId('session-stopped')
    const runId = RunId('run-stopped')
    const events: string[] = []
    const settleInputs: SettleInput[] = []
    const undelivered: readonly UndeliveredSteer[] = [
      {
        delivery: { kind: 'promoted-follow-up', followUpId: FollowUpId('follow-up-steered') },
        handedOff: true,
      },
    ]
    const uninstall = installSessionHostEventPublisher(() => undefined)
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
              text: 'Work.',
              attachmentIds: [],
              callerId: 'local-user',
              acceptedAt: 1000,
              idempotencyKey: 'start',
            },
          }),
        settle: (input) =>
          Effect.sync(() => {
            events.push('settle')
            settleInputs.push(input)
            return { accepted: true, stateRevision: 4 }
          }),
        recoverHostLoss: Effect.succeed([]),
      }),
      Layer.succeed(SessionControlRunExecutor, {
        execute: () =>
          Effect.sync(() => {
            events.push('execute')
            return { terminalStatus: 'interrupted' as const }
          }),
      }),
      Layer.succeed(AgentSteeringService, {
        steer: () => Effect.die('No steering in this test.'),
        takeUndelivered: (takenRunId) =>
          Effect.sync(() => {
            events.push(`take:${takenRunId}`)
            return undelivered
          }),
      }),
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

    expect(events).toEqual(['execute', `take:${runId}`, 'settle'])
    expect(settleInputs).toEqual([
      expect.objectContaining({
        runId,
        terminalStatus: 'interrupted',
        undeliveredSteers: undelivered,
      }),
    ])
  })
})
