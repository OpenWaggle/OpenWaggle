import {
  FollowUpId,
  ReportCorrelationId,
  ReportId,
  RunId,
  SessionId,
  SupportedModelId,
} from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionControlSessionState } from '../../domain/session-control/message-aggregate'
import { applyRunInterruption } from '../../domain/session-control/run-interruption'
import {
  activateStartingRun,
  settleAndScheduleNextFollowUp,
} from '../../domain/session-control/run-lifecycle'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import {
  cancelAllSessionRuns,
  interruptExactSessionRun,
  requestExactSessionRunInterruption,
  reserveCompactionSessionWriter,
} from '../active-session-runs'
import { dispatchAcceptedSessionControlRun } from '../session-control-command-service'
import { SessionHostEventHub } from '../session-host-event-hub'
import { SessionHostLiveness } from '../session-host-liveness'

describe('Session Control Run dispatch behind compaction', () => {
  afterEach(() => cancelAllSessionRuns())

  it('keeps the committed Run scheduled until the compaction writer releases', async () => {
    const sessionId = SessionId('session-compacting-follow-up')
    const runId = RunId('run-after-compaction')
    let state: SessionControlSessionState = {
      sessionId,
      revision: 1,
      run: {
        state: 'starting',
        runId,
        intent: {
          text: 'Continue after compaction.',
          attachmentIds: [],
          callerId: 'gui:local-user',
          acceptedAt: 1_000,
          idempotencyKey: 'follow-up-after-compaction',
        },
      },
      followUpQueue: { state: 'running', revision: 0, items: [] },
    }
    const execute = vi.fn(() => Effect.succeed({ terminalStatus: 'completed' as const }))
    const lifecycle = Layer.succeed(SessionControlRunLifecycleRepository, {
      activate: ({ runId: activatingRunId }) =>
        Effect.sync(() => {
          const result = activateStartingRun(state, activatingRunId)
          if (!result.accepted) return result
          if (state.run.state !== 'starting') throw new Error('Missing starting Run intent.')
          const intent = state.run.intent
          state = result.state
          return { accepted: true, stateRevision: state.revision, intent }
        }),
      settle: ({ runId: settlingRunId, nextRunId }) =>
        Effect.sync(() => {
          const result = settleAndScheduleNextFollowUp(state, settlingRunId, nextRunId)
          if (!result.accepted) return result
          state = result.state
          return {
            accepted: true,
            stateRevision: state.revision,
            ...(result.scheduled ? { scheduled: result.scheduled } : {}),
          }
        }),
      recoverHostLoss: Effect.succeed([]),
    })
    const layer = Layer.mergeAll(
      lifecycle,
      Layer.succeed(SessionControlRunExecutor, { execute }),
      Layer.succeed(SessionControlIdentityService, {
        nextRunId: Effect.succeed(RunId('unused-next-run')),
        nextFollowUpId: Effect.succeed(FollowUpId('unused-follow-up')),
        nextReportId: Effect.succeed(ReportId('unused-report')),
        nextReportCorrelationId: Effect.succeed(ReportCorrelationId('unused-correlation')),
        now: Effect.succeed(2_000),
      }),
      Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
        deliverPendingToActiveRun: () => Effect.succeed(false),
        deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
      }),
    )
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    const releaseRuntime = installSessionHostEventRuntime({
      eventHub: new SessionHostEventHub(),
      liveness,
    })
    const compaction = reserveCompactionSessionWriter(
      sessionId,
      new AbortController(),
      SupportedModelId('openai/gpt-5.5'),
    )

    try {
      await expect(
        Effect.runPromise(
          dispatchAcceptedSessionControlRun(
            {
              contractVersion: 2,
              requestId: 'request-follow-up-after-compaction',
              idempotencyKey: 'follow-up-after-compaction',
              replayed: false,
              outcome: {
                operation: 'follow-up',
                effect: 'started-run',
                sessionId,
                runId,
                stateRevision: 1,
              },
            },
            undefined,
          ).pipe(Effect.provide(layer)),
        ),
      ).resolves.toBe(true)
      expect(execute).not.toHaveBeenCalled()

      compaction.release()
      await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(state.run).toEqual({ state: 'idle' }))
    } finally {
      compaction.release()
      releaseRuntime()
      liveness.close()
    }
  })

  it.each(['interrupt', 'request-interrupt'] as const)(
    'settles a deferred %s and accepts a new Run before compaction finishes',
    async (operation) => {
      const sessionId = SessionId(`session-compaction-${operation}`)
      const runId = RunId('cancelled-deferred-run')
      const nextRunId = RunId('replacement-deferred-run')
      const intent = {
        text: 'Continue after compaction.',
        attachmentIds: [],
        callerId: 'gui:local-user',
        acceptedAt: 1_000,
        idempotencyKey: 'deferred-run',
      }
      let state: SessionControlSessionState = {
        sessionId,
        revision: 1,
        run: { state: 'starting', runId, intent },
        followUpQueue: { state: 'running', revision: 0, items: [] },
      }
      const execute = vi.fn(() => Effect.succeed({ terminalStatus: 'completed' as const }))
      const terminalStatuses: string[] = []
      const layer = Layer.mergeAll(
        Layer.succeed(SessionControlRunExecutor, { execute }),
        Layer.succeed(SessionControlIdentityService, {
          nextRunId: Effect.succeed(RunId('unused-next-run')),
          nextFollowUpId: Effect.succeed(FollowUpId('unused-follow-up')),
          nextReportId: Effect.succeed(ReportId('unused-report')),
          nextReportCorrelationId: Effect.succeed(ReportCorrelationId('unused-correlation')),
          now: Effect.succeed(2_000),
        }),
        Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
          deliverPendingToActiveRun: () => Effect.succeed(false),
          deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
        }),
        Layer.succeed(SessionControlRunLifecycleRepository, {
          activate: ({ runId: activatingRunId }) =>
            Effect.sync(() => {
              const result = activateStartingRun(state, activatingRunId)
              if (!result.accepted) return result
              if (state.run.state !== 'starting') throw new Error('Missing starting Run intent.')
              const activeIntent = state.run.intent
              state = result.state
              return { accepted: true, stateRevision: state.revision, intent: activeIntent }
            }),
          settle: ({ runId: settlingRunId, nextRunId: scheduledRunId, terminalStatus }) =>
            Effect.sync(() => {
              const result = settleAndScheduleNextFollowUp(state, settlingRunId, scheduledRunId)
              if (!result.accepted) return result
              terminalStatuses.push(terminalStatus)
              state = result.state
              return { accepted: true, stateRevision: state.revision }
            }),
          recoverHostLoss: Effect.succeed([]),
        }),
      )
      const liveness = new SessionHostLiveness({
        idleGracePeriodMs: 60_000,
        requestShutdown: vi.fn(),
      })
      const releaseRuntime = installSessionHostEventRuntime({
        eventHub: new SessionHostEventHub(),
        liveness,
      })
      const compactionController = new AbortController()
      const compaction = reserveCompactionSessionWriter(
        sessionId,
        compactionController,
        SupportedModelId('openai/gpt-5.5'),
      )
      const dispatch = (startingRunId: RunId) =>
        Effect.runPromise(
          dispatchAcceptedSessionControlRun(
            {
              contractVersion: 2,
              requestId: `request-${startingRunId}`,
              idempotencyKey: `idempotency-${startingRunId}`,
              replayed: false,
              outcome: {
                operation: 'message',
                effect: 'started-run',
                sessionId,
                runId: startingRunId,
                stateRevision: state.revision,
              },
            },
            undefined,
          ).pipe(Effect.provide(layer)),
        )

      try {
        await expect(dispatch(runId)).resolves.toBe(true)
        state = applyRunInterruption({ state, expectedRunId: runId }).state
        const interrupted =
          operation === 'interrupt'
            ? await interruptExactSessionRun(sessionId, runId)
            : requestExactSessionRunInterruption(sessionId, runId)
        expect(interrupted).toBe(true)
        await vi.waitFor(() => expect(state.run).toEqual({ state: 'idle' }))
        expect(compactionController.signal.aborted).toBe(false)
        expect(terminalStatuses).toEqual(['interrupted'])
        expect(execute).not.toHaveBeenCalled()

        state = {
          ...state,
          revision: state.revision + 1,
          run: { state: 'starting', runId: nextRunId, intent },
        }
        await expect(dispatch(nextRunId)).resolves.toBe(true)
        expect(execute).not.toHaveBeenCalled()
        compaction.release()
        await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({ runId: nextRunId }))
        await vi.waitFor(() => expect(state.run).toEqual({ state: 'idle' }))
        expect(terminalStatuses).toEqual(['interrupted', 'completed'])
      } finally {
        compaction.release()
        releaseRuntime()
        liveness.close()
      }
    },
  )
})
