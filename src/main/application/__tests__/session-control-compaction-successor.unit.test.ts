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
import {
  activateStartingRun,
  settleAndScheduleNextFollowUp,
} from '../../domain/session-control/run-lifecycle'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import { cancelAllSessionRuns, reserveCompactionSessionWriter } from '../active-session-runs'
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
})
