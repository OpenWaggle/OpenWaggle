import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import type { SessionControlSessionState } from '../../domain/session-control/message-aggregate'
import {
  activateStartingRun,
  settleAndScheduleNextFollowUp,
} from '../../domain/session-control/run-lifecycle'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { activeRuns, interruptExactSessionRun } from '../active-session-runs'
import { dispatchAcceptedSessionControlRun } from '../session-control-command-service'
import { coordinateSessionRuns } from '../session-control-run-coordinator'

describe('Session Control Run coordinator', () => {
  it('executes queued Follow-ups one at a time after the active Run settles', async () => {
    const sessionId = SessionId('session-target')
    let state: SessionControlSessionState = {
      sessionId,
      revision: 2,
      run: {
        state: 'starting',
        runId: RunId('run-first'),
        intent: {
          text: 'First task.',
          attachmentIds: [],
          callerId: 'local-user',
          acceptedAt: 1000,
          idempotencyKey: 'first',
        },
      },
      followUpQueue: {
        state: 'running',
        revision: 1,
        items: [
          {
            id: FollowUpId('follow-up-second'),
            deliveryState: 'pending',
            intent: {
              text: 'Second task.',
              attachmentIds: [],
              callerId: 'local-user',
              acceptedAt: 1001,
              idempotencyKey: 'second',
            },
          },
        ],
      },
    }
    const generatedRunIds = [RunId('run-second'), RunId('run-unused')]
    const executedTexts: string[] = []
    const deliveredParents: string[] = []
    const layer = Layer.mergeAll(
      Layer.succeed(SessionControlIdentityService, {
        nextRunId: Effect.sync(() => {
          const next = generatedRunIds.shift()
          if (!next) throw new Error('No Run identity available.')
          return next
        }),
        nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
        nextReportId: Effect.succeed(ReportId('report-unused')),
        nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
        now: Effect.succeed(2000),
      }),
      Layer.succeed(SessionControlRunLifecycleRepository, {
        activate: ({ runId }) =>
          Effect.sync(() => {
            const result = activateStartingRun(state, runId)
            if (!result.accepted) return result
            if (state.run.state !== 'starting') throw new Error('Missing starting intent.')
            const intent = state.run.intent
            state = result.state
            return { accepted: true, stateRevision: state.revision, intent }
          }),
        settle: ({ runId, nextRunId }) =>
          Effect.sync(() => {
            const result = settleAndScheduleNextFollowUp(state, runId, nextRunId)
            if (!result.accepted) return result
            state = result.state
            return {
              accepted: true,
              stateRevision: state.revision,
              ...(result.scheduled ? { scheduled: result.scheduled } : {}),
              ...(runId === RunId('run-first')
                ? {
                    orchestrationUpdate: {
                      updateId: 'update-worker',
                      parentSessionId: SessionId('queen'),
                      workerSessionId: sessionId,
                      delegationId: 'delegation-worker',
                      sourceRunId: runId,
                      state: 'ready_for_review' as const,
                    },
                  }
                : {}),
            }
          }),
        recoverHostLoss: Effect.succeed([]),
      }),
      Layer.succeed(SessionControlRunExecutor, {
        execute: (execution) =>
          Effect.sync(() => {
            executedTexts.push(execution.intent.text)
            return { terminalStatus: 'completed' as const }
          }),
      }),
      Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
        deliverPendingToActiveRun: ({ parentSessionId }) =>
          Effect.sync(() => {
            deliveredParents.push(parentSessionId)
            return true
          }),
        deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
      }),
    )

    const result = await Effect.runPromise(
      coordinateSessionRuns({ sessionId, startingRunId: RunId('run-first') }).pipe(
        Effect.provide(layer),
      ),
    )

    expect(executedTexts).toEqual(['First task.', 'Second task.'])
    expect(deliveredParents).toEqual(['queen'])
    expect(result).toEqual([
      { runId: RunId('run-first'), terminalStatus: 'completed' },
      { runId: RunId('run-second'), terminalStatus: 'completed' },
    ])
    expect(state).toMatchObject({
      revision: 6,
      run: { state: 'idle' },
      followUpQueue: { revision: 2, items: [] },
    })
  })

  it('reserves an interruptible Run before activation and settles an interrupted starting Run', async () => {
    const sessionId = SessionId('session-activation-race')
    const runId = RunId('run-activation-race')
    let releaseActivation: () => void = () => undefined
    const activationGate = new Promise<void>((resolve) => {
      releaseActivation = resolve
    })
    let markActivationEntered: () => void = () => undefined
    const activationEntered = new Promise<void>((resolve) => {
      markActivationEntered = resolve
    })
    let executorCalls = 0
    const settlements: Array<{ runId: RunId; terminalStatus: string }> = []
    const layer = Layer.mergeAll(
      Layer.succeed(SessionControlIdentityService, {
        nextRunId: Effect.succeed(RunId('run-unused')),
        nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
        nextReportId: Effect.succeed(ReportId('report-unused')),
        nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
        now: Effect.succeed(2000),
      }),
      Layer.succeed(SessionControlRunLifecycleRepository, {
        activate: () =>
          Effect.promise(async () => {
            markActivationEntered()
            await activationGate
            return { accepted: false, code: 'run_not_starting' as const }
          }),
        settle: (input) =>
          Effect.sync(() => {
            settlements.push({ runId: input.runId, terminalStatus: input.terminalStatus })
            return { accepted: true, stateRevision: 3 }
          }),
        recoverHostLoss: Effect.succeed([]),
      }),
      Layer.succeed(SessionControlRunExecutor, {
        execute: () =>
          Effect.sync(() => {
            executorCalls += 1
            return { terminalStatus: 'completed' as const }
          }),
      }),
      Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
        deliverPendingToActiveRun: () => Effect.succeed(false),
        deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
      }),
    )

    const coordinated = Effect.runPromise(
      coordinateSessionRuns({ sessionId, startingRunId: runId }).pipe(Effect.provide(layer)),
    )
    await activationEntered

    const interruption = interruptExactSessionRun(sessionId, runId)
    expect(activeRuns.get(sessionId)?.controller.signal.aborted).toBe(true)
    releaseActivation()

    await expect(interruption).resolves.toBe(true)
    await expect(coordinated).resolves.toEqual([{ runId, terminalStatus: 'interrupted' }])
    expect(executorCalls).toBe(0)
    expect(settlements).toEqual([{ runId, terminalStatus: 'interrupted' }])
    expect(activeRuns.has(sessionId)).toBe(false)
  })

  it('establishes the reservation before an accepted mutation returns to its caller', async () => {
    const sessionId = SessionId('session-admission-race')
    const runId = RunId('run-admission-race')
    let releaseActivation: () => void = () => undefined
    const activationGate = new Promise<void>((resolve) => {
      releaseActivation = resolve
    })
    const layer = Layer.mergeAll(
      Layer.succeed(SessionControlIdentityService, {
        nextRunId: Effect.succeed(RunId('run-unused')),
        nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
        nextReportId: Effect.succeed(ReportId('report-unused')),
        nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
        now: Effect.succeed(2000),
      }),
      Layer.succeed(SessionControlRunLifecycleRepository, {
        activate: () =>
          Effect.promise(async () => {
            await activationGate
            return { accepted: false, code: 'run_not_starting' as const }
          }),
        settle: () => Effect.succeed({ accepted: true, stateRevision: 2 }),
        recoverHostLoss: Effect.succeed([]),
      }),
      Layer.succeed(SessionControlRunExecutor, {
        execute: () => Effect.die('an interrupted starting Run must not execute'),
      }),
      Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
        deliverPendingToActiveRun: () => Effect.succeed(false),
        deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
      }),
    )

    await Effect.runPromise(
      dispatchAcceptedSessionControlRun(
        {
          contractVersion: 2,
          requestId: 'request-message',
          idempotencyKey: 'message-once',
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
      ).pipe(Effect.provide(layer)),
    )

    expect(activeRuns.get(sessionId)?.metadata.runId).toBe(runId)
    const interruption = interruptExactSessionRun(sessionId, runId)
    releaseActivation()
    await expect(interruption).resolves.toBe(true)
    await vi.waitFor(() => expect(activeRuns.has(sessionId)).toBe(false))
  })
})
