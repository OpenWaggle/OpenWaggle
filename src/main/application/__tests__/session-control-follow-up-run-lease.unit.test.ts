import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionControlSessionState } from '../../domain/session-control/message-aggregate'
import {
  activateStartingRun,
  settleAndScheduleNextFollowUp,
} from '../../domain/session-control/run-lifecycle'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRepository } from '../../ports/session-control-repository'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import { activeRuns } from '../active-session-runs'
import { executeSessionControlMutation } from '../session-control-command-service'
import { SessionHostEventHub } from '../session-host-event-hub'
import { SessionHostLiveness } from '../session-host-liveness'
import { unusedCommandDependencies } from './session-control-command-test-layer'

describe('idle Follow-up Session Host run lease', () => {
  afterEach(() => {
    for (const sessionId of activeRuns.keys()) activeRuns.delete(sessionId)
  })

  it('transfers the command lease to the Run coordinator until durable settlement completes', async () => {
    const sessionId = SessionId('session-idle-follow-up')
    const runId = RunId('run-idle-follow-up')
    let state: SessionControlSessionState = {
      sessionId,
      revision: 1,
      run: { state: 'idle' },
      followUpQueue: { state: 'running', revision: 0, items: [] },
    }
    const settleEntered = Promise.withResolvers<void>()
    const allowSettlement = Promise.withResolvers<void>()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
    const releaseRuntime = installSessionHostEventRuntime({
      eventHub: new SessionHostEventHub(),
      liveness,
    })
    const generatedRunIds = [runId, RunId('run-after-settlement')]
    const layer = Layer.mergeAll(
      unusedCommandDependencies(),
      Layer.succeed(SessionControlRepository, {
        executeMutation: (input) =>
          Effect.sync(() => {
            const decision = input.decide(state)
            if (decision.accepted) state = decision.state
            return { replayed: false, outcome: decision.outcome }
          }),
      }),
      Layer.succeed(SessionControlIdentityService, {
        nextRunId: Effect.sync(() => {
          const nextRunId = generatedRunIds.shift()
          if (!nextRunId) throw new Error('No Run identity available.')
          return nextRunId
        }),
        nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
        nextReportId: Effect.succeed(ReportId('report-unused')),
        nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
        now: Effect.succeed(1_000),
      }),
      Layer.succeed(SessionControlRunLifecycleRepository, {
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
          Effect.promise(async () => {
            settleEntered.resolve()
            await allowSettlement.promise
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
      const response = await Effect.runPromise(
        executeSessionControlMutation({
          callerId: 'local-user',
          request: {
            contractVersion: 2,
            requestId: 'request-idle-follow-up',
            idempotencyKey: 'idle-follow-up-once',
            command: {
              operation: 'follow-up',
              sessionId,
              input: { text: 'Continue after the previous Run.', attachmentIds: [] },
            },
          },
        }).pipe(Effect.provide(layer)),
      )
      await settleEntered.promise

      expect(response.outcome).toMatchObject({
        operation: 'follow-up',
        effect: 'started-run',
        sessionId,
        runId,
      })
      expect(liveness.ownerCount('run')).toBe(1)
      liveness.requestDrain()
      expect(requestShutdown).not.toHaveBeenCalled()

      allowSettlement.resolve()
      await vi.waitFor(() => expect(requestShutdown).toHaveBeenCalledOnce())
      expect(liveness.ownerCount('run')).toBe(0)
      expect(state.run).toEqual({ state: 'idle' })
    } finally {
      allowSettlement.resolve()
      releaseRuntime()
      liveness.close()
    }
  })

  it('releases a Follow-up edit hold while the Host drains, without starting the next Run', async () => {
    const sessionId = SessionId('session-draining-edit')
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    const releaseRuntime = installSessionHostEventRuntime({
      eventHub: new SessionHostEventHub(),
      liveness,
    })
    const mutations: { readonly operation: string; readonly nextRunId?: string }[] = []
    const layer = Layer.mergeAll(
      unusedCommandDependencies(),
      Layer.succeed(SessionControlRepository, {
        executeMutation: (input) =>
          Effect.sync(() => {
            mutations.push({
              operation: input.request.command.operation,
              ...(input.nextRunId ? { nextRunId: input.nextRunId } : {}),
            })
            return {
              replayed: false,
              outcome: {
                operation: 'queue-edit-cancel' as const,
                effect: 'queue-updated' as const,
                sessionId,
                queueState: 'running' as const,
                queueRevision: 2,
                followUpIds: ['held'],
                stateRevision: 3,
              },
            }
          }),
      }),
      Layer.succeed(SessionControlIdentityService, {
        nextRunId: Effect.succeed(RunId('run-not-admitted')),
        nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
        nextReportId: Effect.succeed(ReportId('report-unused')),
        nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
        now: Effect.succeed(1_000),
      }),
      Layer.succeed(SessionControlRunLifecycleRepository, fromPartial({})),
      Layer.succeed(SessionControlRunExecutor, fromPartial({})),
      Layer.succeed(SessionOrchestrationUpdateDeliveryService, fromPartial({})),
    )
    const command = (operation: 'queue-edit-cancel' | 'follow-up') =>
      executeSessionControlMutation({
        callerId: 'gui:local-user',
        request: {
          contractVersion: 2,
          requestId: `request-${operation}`,
          idempotencyKey: `key-${operation}`,
          command:
            operation === 'follow-up'
              ? { operation, sessionId, input: { text: 'Later', attachmentIds: [] } }
              : { operation, sessionId, followUpId: 'held', holdId: 'hold-1' },
        },
      }).pipe(Effect.provide(layer))

    try {
      liveness.requestDrain()
      const released = await Effect.runPromise(command('queue-edit-cancel'))
      const refused = await Effect.runPromiseExit(command('follow-up'))

      expect(released.outcome).toMatchObject({ effect: 'queue-updated' })
      expect(mutations).toEqual([{ operation: 'queue-edit-cancel' }])
      expect(refused._tag).toBe('Failure')
    } finally {
      releaseRuntime()
      liveness.close()
    }
  })
})
