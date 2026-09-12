import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { SessionControlSessionState } from '../../domain/session-control/message-aggregate'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRepository } from '../../ports/session-control-repository'
import {
  mutateSessionQueue,
  startSessionRun,
  submitSessionMessage,
} from '../session-control-service'

function testLayer(
  state: SessionControlSessionState,
  update: (state: SessionControlSessionState) => void,
) {
  return Layer.merge(
    Layer.succeed(SessionControlRepository, {
      executeMutation: (input) =>
        Effect.sync(() => {
          const decision = input.decide(state)
          if (decision.accepted) update(decision.state)
          return { replayed: false, outcome: decision.outcome }
        }),
    }),
    Layer.succeed(SessionControlIdentityService, {
      nextRunId: Effect.succeed(RunId('run-next')),
      nextFollowUpId: Effect.succeed(FollowUpId('follow-up-next')),
      nextReportId: Effect.succeed(ReportId('report-next')),
      nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-next')),
      now: Effect.succeed(1234),
    }),
  )
}

describe('Session Control caller authorization ceiling', () => {
  it.each(['message', 'start'] as const)('clamps ask-capped %s Runs', async (operation) => {
    let state: SessionControlSessionState = {
      sessionId: SessionId('session-target'),
      revision: 0,
      run: { state: 'idle' },
      followUpQueue: { state: 'running', revision: 0, items: [] },
    }
    const effect =
      operation === 'message'
        ? submitSessionMessage({
            callerId: 'profile:limited',
            callerAuthorizationCeiling: 'ask-for-approval',
            request: {
              contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
              requestId: 'request-message',
              idempotencyKey: 'idempotency-message',
              command: {
                operation: 'message',
                sessionId: 'session-target',
                input: { text: 'Work safely.', attachmentIds: [] },
              },
            },
          })
        : startSessionRun({
            callerId: 'profile:limited',
            callerAuthorizationCeiling: 'ask-for-approval',
            request: {
              contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
              requestId: 'request-start',
              idempotencyKey: 'idempotency-start',
              command: {
                operation: 'start',
                sessionId: 'session-target',
                runAuthorizationOverride: 'yolo',
                input: { text: 'Work safely.', attachmentIds: [] },
              },
            },
          })
    await Effect.runPromise(effect.pipe(Effect.provide(testLayer(state, (next) => (state = next)))))
    expect(state.run).toMatchObject({
      state: 'starting',
      intent: { runAuthorizationOverride: 'ask-for-approval' },
    })
  })

  it('clamps a queued YOLO Follow-up when an ask-capped caller resumes it', async () => {
    let state: SessionControlSessionState = {
      sessionId: SessionId('session-target'),
      revision: 2,
      run: { state: 'idle' },
      followUpQueue: {
        state: 'paused',
        revision: 1,
        items: [
          {
            id: FollowUpId('follow-up-1'),
            deliveryState: 'pending',
            intent: {
              text: 'Continue.',
              attachmentIds: [],
              runAuthorizationOverride: 'yolo',
              callerId: 'profile:unrestricted',
              acceptedAt: 1,
              idempotencyKey: 'queued',
            },
          },
        ],
      },
    }
    await Effect.runPromise(
      mutateSessionQueue({
        callerId: 'profile:limited',
        callerAuthorizationCeiling: 'ask-for-approval',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-resume',
          idempotencyKey: 'idempotency-resume',
          command: {
            operation: 'queue-resume',
            sessionId: 'session-target',
            expectedQueueRevision: 1,
          },
        },
      }).pipe(Effect.provide(testLayer(state, (next) => (state = next)))),
    )
    expect(state.run).toMatchObject({
      state: 'starting',
      intent: { runAuthorizationOverride: 'ask-for-approval' },
    })
  })
})
