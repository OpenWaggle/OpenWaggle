import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionControlRepositoryError } from '../../errors'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import { activeRuns } from '../active-session-runs'
import { dispatchAcceptedSessionControlRun } from '../session-control-command-service'
import { SessionHostEventHub } from '../session-host-event-hub'
import { SessionHostLiveness } from '../session-host-liveness'

function runLayer(failurePoint: 'activate' | 'settle') {
  return Layer.mergeAll(
    Layer.succeed(SessionControlIdentityService, {
      nextRunId: Effect.succeed(RunId('run-unused')),
      nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
      nextReportId: Effect.succeed(ReportId('report-unused')),
      nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
      now: Effect.succeed(2000),
    }),
    Layer.succeed(SessionControlRunLifecycleRepository, {
      activate: () =>
        failurePoint === 'activate'
          ? Effect.fail(
              new SessionControlRepositoryError({
                operation: 'activate-run',
                cause: new Error('activation storage failed'),
              }),
            )
          : Effect.succeed({
              accepted: true as const,
              stateRevision: 2,
              intent: {
                text: 'Run once.',
                attachmentIds: [],
                callerId: 'local-user',
                acceptedAt: 1000,
                idempotencyKey: 'run-once',
              },
            }),
      settle: () =>
        failurePoint === 'settle'
          ? Effect.fail(
              new SessionControlRepositoryError({
                operation: 'settle-run',
                cause: new Error('settlement storage failed'),
              }),
            )
          : Effect.succeed({ accepted: true as const, stateRevision: 3 }),
      recoverHostLoss: Effect.succeed([]),
    }),
    Layer.succeed(SessionControlRunExecutor, {
      execute: () => Effect.succeed({ terminalStatus: 'completed' as const }),
    }),
    Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
      deliverPendingToActiveRun: () => Effect.succeed(false),
      deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
    }),
  )
}

describe('Session Control Run supervision', () => {
  afterEach(() => {
    for (const sessionId of activeRuns.keys()) activeRuns.delete(sessionId)
  })

  it.each(['activate', 'settle'] as const)(
    'drains the Host when durable Run %s fails so startup recovery can settle it',
    async (failurePoint) => {
      const sessionId = SessionId(`session-${failurePoint}-failure`)
      const runId = RunId(`run-${failurePoint}-failure`)
      const requestShutdown = vi.fn()
      const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
      const releaseRuntime = installSessionHostEventRuntime({
        eventHub: new SessionHostEventHub(),
        liveness,
      })

      try {
        await Effect.runPromise(
          dispatchAcceptedSessionControlRun(
            {
              contractVersion: 2,
              requestId: `request-${failurePoint}`,
              idempotencyKey: `idempotency-${failurePoint}`,
              replayed: false,
              outcome: {
                operation: 'message',
                effect: 'started-run',
                sessionId,
                runId,
                stateRevision: 1,
              },
            },
            undefined,
          ).pipe(Effect.provide(runLayer(failurePoint))),
        )

        await vi.waitFor(() => expect(requestShutdown).toHaveBeenCalledOnce())
        expect(liveness.isDraining()).toBe(true)
        expect(activeRuns.has(sessionId)).toBe(false)
      } finally {
        releaseRuntime()
        liveness.close()
      }
    },
  )
})
