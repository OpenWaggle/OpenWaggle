import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import type { SessionLifecycleResponse } from '@shared/types/session-lifecycle'
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
import { SessionHostEventHub } from '../session-host-event-hub'
import { SessionHostLiveness } from '../session-host-liveness'
import { dispatchAcceptedLifecycleRun } from '../session-lifecycle-command-service'

function launchedResponse(replayed = false): SessionLifecycleResponse {
  return {
    contractVersion: 2,
    requestId: 'request-launch',
    idempotencyKey: 'idempotency-launch',
    replayed,
    outcome: {
      operation: 'launch',
      effect: 'launched-root',
      sessionId: 'session-launch',
      runId: 'run-launch',
      workspaceId: 'workspace-launch',
    },
  }
}

describe('Session lifecycle command dispatch', () => {
  afterEach(() => {
    for (const sessionId of activeRuns.keys()) activeRuns.delete(sessionId)
  })

  it('hands a newly accepted starting Run to the durable run coordinator', async () => {
    const events: string[] = []
    const layer = Layer.mergeAll(
      Layer.succeed(SessionControlIdentityService, {
        nextRunId: Effect.succeed(RunId('run-unused')),
        nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
        nextReportId: Effect.succeed(ReportId('report-unused')),
        nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
        now: Effect.succeed(1),
      }),
      Layer.succeed(SessionControlRunLifecycleRepository, {
        activate: ({ sessionId, runId }) =>
          Effect.sync(() => {
            events.push(`activate:${sessionId}:${runId}`)
            return {
              accepted: true,
              stateRevision: 2,
              intent: {
                text: 'Run the audit.',
                attachmentIds: [],
                callerId: 'local-user',
                acceptedAt: 1,
                idempotencyKey: 'idempotency-launch',
              },
            }
          }),
        settle: ({ sessionId, runId }) =>
          Effect.sync(() => {
            events.push(`settle:${sessionId}:${runId}`)
            return { accepted: true, stateRevision: 3 }
          }),
        recoverHostLoss: Effect.succeed([]),
      }),
      Layer.succeed(SessionControlRunExecutor, {
        execute: ({ sessionId, runId }) =>
          Effect.sync(() => {
            events.push(`execute:${sessionId}:${runId}`)
            return { terminalStatus: 'completed' as const }
          }),
      }),
      Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
        deliverPendingToActiveRun: () => Effect.succeed(false),
        deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
      }),
    )

    let allowDispatch: (() => void) | undefined
    const beforeDispatch = Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          allowDispatch = resolve
        }),
    )
    const dispatch = Effect.runPromise(
      dispatchAcceptedLifecycleRun(launchedResponse(), undefined, beforeDispatch).pipe(
        Effect.provide(layer),
      ),
    )
    await vi.waitFor(() => expect(allowDispatch).toBeTypeOf('function'))
    expect(events).toEqual([])
    expect(activeRuns.has(SessionId('session-launch'))).toBe(false)
    allowDispatch?.()
    await dispatch
    for (let attempt = 0; attempt < 20 && events.length < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }

    expect(events).toEqual([
      `activate:${SessionId('session-launch')}:${RunId('run-launch')}`,
      `execute:${SessionId('session-launch')}:${RunId('run-launch')}`,
      `settle:${SessionId('session-launch')}:${RunId('run-launch')}`,
    ])
  })

  it('does not dispatch a replayed lifecycle result', async () => {
    const layer = Layer.mergeAll(
      Layer.succeed(SessionControlIdentityService, {
        nextRunId: Effect.die('must not allocate'),
        nextFollowUpId: Effect.die('must not allocate'),
        nextReportId: Effect.die('must not allocate'),
        nextReportCorrelationId: Effect.die('must not allocate'),
        now: Effect.die('must not read time'),
      }),
      Layer.succeed(SessionControlRunLifecycleRepository, {
        activate: () => Effect.die('must not activate'),
        settle: () => Effect.die('must not settle'),
        recoverHostLoss: Effect.die('must not recover'),
      }),
      Layer.succeed(SessionControlRunExecutor, {
        execute: () => Effect.die('must not execute'),
      }),
      Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
        deliverPendingToActiveRun: () => Effect.succeed(false),
        deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
      }),
    )

    await Effect.runPromise(
      dispatchAcceptedLifecycleRun(launchedResponse(true)).pipe(Effect.provide(layer)),
    )
  })

  it('drains the Host when a launched Run cannot be durably settled', async () => {
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
    const releaseRuntime = installSessionHostEventRuntime({
      eventHub: new SessionHostEventHub(),
      liveness,
    })
    const layer = Layer.mergeAll(
      Layer.succeed(SessionControlIdentityService, {
        nextRunId: Effect.succeed(RunId('run-unused')),
        nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
        nextReportId: Effect.succeed(ReportId('report-unused')),
        nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
        now: Effect.succeed(1),
      }),
      Layer.succeed(SessionControlRunLifecycleRepository, {
        activate: () =>
          Effect.succeed({
            accepted: true as const,
            stateRevision: 2,
            intent: {
              text: 'Run the audit.',
              attachmentIds: [],
              callerId: 'local-user',
              acceptedAt: 1,
              idempotencyKey: 'idempotency-launch',
            },
          }),
        settle: () =>
          Effect.fail(
            new SessionControlRepositoryError({
              operation: 'settle-run',
              cause: new Error('settlement storage failed'),
            }),
          ),
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

    try {
      await Effect.runPromise(
        dispatchAcceptedLifecycleRun(launchedResponse()).pipe(Effect.provide(layer)),
      )
      await vi.waitFor(() => expect(requestShutdown).toHaveBeenCalledOnce())
      expect(liveness.isDraining()).toBe(true)
      expect(activeRuns.has(SessionId('session-launch'))).toBe(false)
    } finally {
      releaseRuntime()
      liveness.close()
    }
  })
})
