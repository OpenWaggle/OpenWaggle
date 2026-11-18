import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { UsageStatisticsRecorder } from '../../ports/usage-statistics-recorder'
import { coordinateSessionRuns } from '../session-control-run-coordinator'

const SESSION_ID = SessionId('session-usage-statistics')
const RUN_ID = RunId('run-usage-statistics')

function coordinatorLayer(input: {
  readonly events: unknown[]
  readonly activationAccepted?: boolean
  readonly recorder?: 'working' | 'failing'
}) {
  const record = (event: unknown) => Effect.sync(() => void input.events.push(event))
  const recorderLayer =
    input.recorder === undefined
      ? Layer.empty
      : Layer.succeed(
          UsageStatisticsRecorder,
          input.recorder === 'working'
            ? {
                record: (observation) => record({ record: observation }),
                runStarted: (start) => record({ runStarted: start }),
                runFinished: (finish) => record({ runFinished: finish }),
              }
            : {
                record: () => Effect.die('recorder broke'),
                runStarted: () => Effect.die('recorder broke'),
                runFinished: () => Effect.die('recorder broke'),
              },
        )
  return Layer.mergeAll(
    recorderLayer,
    Layer.succeed(SessionControlIdentityService, {
      nextRunId: Effect.succeed(RunId('run-next')),
      nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
      nextReportId: Effect.succeed(ReportId('report-unused')),
      nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
      now: Effect.succeed(2000),
    }),
    Layer.succeed(SessionControlRunLifecycleRepository, {
      activate: () =>
        Effect.succeed(
          input.activationAccepted === false
            ? { accepted: false as const, code: 'run_not_starting' as const }
            : {
                accepted: true as const,
                stateRevision: 1,
                intent: {
                  text: 'Reply with OK.',
                  attachmentIds: ['attachment-1'],
                  thinkingLevel: 'low' as const,
                  runAuthorizationOverride: 'yolo' as const,
                  callerId: 'local-user:reauthorizer',
                  authorCallerId: 'gui:local-user',
                  acceptedAt: 1000,
                  idempotencyKey: 'usage-statistics',
                },
              },
        ),
      settle: () =>
        record('settled').pipe(Effect.as({ accepted: true as const, stateRevision: 2 })),
      recoverHostLoss: Effect.succeed([]),
    }),
    Layer.succeed(SessionControlRunExecutor, {
      execute: () => record('executed').pipe(Effect.as({ terminalStatus: 'completed' as const })),
    }),
    Layer.succeed(AgentSteeringService, {
      steer: () => Effect.die('No steering in this test.'),
      readUndelivered: () => Effect.succeed([]),
      forgetUndelivered: () => Effect.void,
    }),
    Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
      deliverPendingToActiveRun: () => Effect.succeed(false),
      deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
    }),
  )
}

function coordinate(layer: ReturnType<typeof coordinatorLayer>) {
  return Effect.runPromise(
    coordinateSessionRuns({ sessionId: SESSION_ID, startingRunId: RUN_ID }).pipe(
      Effect.provide(layer),
    ),
  )
}

describe('Session Control Run coordinator Usage statistics', () => {
  it('records the Run start before it executes and its finish before it settles', async () => {
    const events: unknown[] = []

    await coordinate(coordinatorLayer({ events, recorder: 'working' }))

    expect(events).toEqual([
      {
        runStarted: {
          sessionId: SESSION_ID,
          runId: RUN_ID,
          originCallerId: 'gui:local-user',
          waggle: false,
          attachments: true,
          runAuthorizationOverride: 'yolo',
        },
      },
      'executed',
      {
        runFinished: {
          runId: RUN_ID,
          originCallerId: 'gui:local-user',
          waggle: false,
          thinkingLevel: 'low',
          terminalStatus: 'completed',
        },
      },
      'settled',
    ])
  })

  it('records nothing for a Run that was never activated', async () => {
    const events: unknown[] = []

    await coordinate(coordinatorLayer({ events, recorder: 'working', activationAccepted: false }))

    expect(events).toEqual([])
  })

  it('runs and settles the Run when the recorder fails or is not provided', async () => {
    for (const recorder of ['failing', undefined] as const) {
      const events: unknown[] = []

      const results = await coordinate(
        coordinatorLayer({ events, ...(recorder ? { recorder } : {}) }),
      )

      expect(events).toEqual(['executed', 'settled'])
      expect(results).toEqual([{ runId: RUN_ID, terminalStatus: 'completed' }])
    }
  })
})
