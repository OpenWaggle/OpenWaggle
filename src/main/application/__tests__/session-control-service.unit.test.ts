import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { SessionControlSessionState } from '../../domain/session-control/message-aggregate'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRepository } from '../../ports/session-control-repository'
import {
  queueSessionFollowUp,
  startSessionRun,
  submitSessionMessage,
} from '../session-control-service'

describe('Session Control application service', () => {
  it('commits adaptive Message submission through the authoritative repository', async () => {
    const sessionId = SessionId('session-target')
    let state: SessionControlSessionState = {
      sessionId,
      revision: 2,
      run: { state: 'idle' },
      followUpQueue: { state: 'running', revision: 0, items: [] },
    }

    const repositoryLayer = Layer.succeed(SessionControlRepository, {
      executeMutation: (input) =>
        Effect.sync(() => {
          const decision = input.decide(state)
          if (decision.accepted) state = decision.state
          return { replayed: false, outcome: decision.outcome }
        }),
    })
    const identityLayer = Layer.succeed(SessionControlIdentityService, {
      nextRunId: Effect.succeed(RunId('run-next')),
      nextFollowUpId: Effect.succeed(FollowUpId('follow-up-next')),
      nextReportId: Effect.succeed(ReportId('report-unused')),
      nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
      now: Effect.succeed(1234),
    })

    const response = await Effect.runPromise(
      submitSessionMessage({
        callerId: 'local-user',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-message',
          idempotencyKey: 'idempotency-message',
          command: {
            operation: 'message',
            sessionId,
            input: {
              text: 'Implement the target schema.',
              attachmentIds: [],
              thinkingLevel: 'high',
            },
          },
        },
      }).pipe(Effect.provide(Layer.merge(repositoryLayer, identityLayer))),
    )

    expect(response).toEqual({
      contractVersion: 2,
      requestId: 'request-message',
      idempotencyKey: 'idempotency-message',
      replayed: false,
      outcome: {
        operation: 'message',
        effect: 'started-run',
        sessionId,
        runId: RunId('run-next'),
        stateRevision: 3,
      },
    })
    expect(state.run).toEqual({
      state: 'starting',
      runId: RunId('run-next'),
      intent: {
        text: 'Implement the target schema.',
        attachmentIds: [],
        thinkingLevel: 'high',
        callerId: 'local-user',
        acceptedAt: 1234,
        idempotencyKey: 'idempotency-message',
      },
    })
  })

  it('commits explicit Run start with a per-Run authorization override', async () => {
    const sessionId = SessionId('session-target')
    let state: SessionControlSessionState = {
      sessionId,
      revision: 5,
      run: { state: 'idle' },
      followUpQueue: { state: 'paused', revision: 2, items: [] },
    }
    const repositoryLayer = Layer.succeed(SessionControlRepository, {
      executeMutation: (input) =>
        Effect.sync(() => {
          const decision = input.decide(state)
          if (decision.accepted) state = decision.state
          return { replayed: false, outcome: decision.outcome }
        }),
    })
    const identityLayer = Layer.succeed(SessionControlIdentityService, {
      nextRunId: Effect.succeed(RunId('run-started')),
      nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
      nextReportId: Effect.succeed(ReportId('report-unused')),
      nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
      now: Effect.succeed(2345),
    })

    const response = await Effect.runPromise(
      startSessionRun({
        callerId: 'local-user',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-start',
          idempotencyKey: 'idempotency-start',
          command: {
            operation: 'start',
            sessionId,
            runAuthorizationOverride: 'yolo',
            input: { text: 'Start now.', attachmentIds: [] },
          },
        },
      }).pipe(Effect.provide(Layer.merge(repositoryLayer, identityLayer))),
    )

    expect(response.outcome).toEqual({
      operation: 'start',
      effect: 'started-run',
      sessionId,
      runId: RunId('run-started'),
      stateRevision: 6,
    })
    expect(state.run).toMatchObject({
      state: 'starting',
      intent: { runAuthorizationOverride: 'yolo' },
    })
  })

  it('commits an explicit Follow-up without changing the active Run', async () => {
    const sessionId = SessionId('session-target')
    const activeRunId = RunId('run-active')
    let state: SessionControlSessionState = {
      sessionId,
      revision: 8,
      run: { state: 'active', runId: activeRunId },
      followUpQueue: { state: 'running', revision: 3, items: [] },
    }
    const repositoryLayer = Layer.succeed(SessionControlRepository, {
      executeMutation: (input) =>
        Effect.sync(() => {
          const decision = input.decide(state)
          if (decision.accepted) state = decision.state
          return { replayed: false, outcome: decision.outcome }
        }),
    })
    const identityLayer = Layer.succeed(SessionControlIdentityService, {
      nextRunId: Effect.succeed(RunId('run-unused')),
      nextFollowUpId: Effect.succeed(FollowUpId('follow-up-next')),
      nextReportId: Effect.succeed(ReportId('report-unused')),
      nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
      now: Effect.succeed(3456),
    })

    const response = await Effect.runPromise(
      queueSessionFollowUp({
        callerId: 'local-user',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-follow-up',
          idempotencyKey: 'idempotency-follow-up',
          command: {
            operation: 'follow-up',
            sessionId,
            runAuthorizationOverride: 'ask-for-approval',
            input: { text: 'Run verification next.', attachmentIds: [] },
          },
        },
      }).pipe(Effect.provide(Layer.merge(repositoryLayer, identityLayer))),
    )

    expect(response.outcome).toEqual({
      operation: 'follow-up',
      effect: 'queued-follow-up',
      sessionId,
      followUpId: FollowUpId('follow-up-next'),
      queueRevision: 4,
      stateRevision: 9,
    })
    expect(state.run).toEqual({ state: 'active', runId: activeRunId })
  })
})
