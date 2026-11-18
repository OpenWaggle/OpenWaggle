import { FollowUpId, ReportCorrelationId, ReportId, RunId } from '@shared/types/brand'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import {
  SessionReportDeliveryService,
  type SessionReportDeliveryServiceShape,
} from '../../ports/session-report-delivery-service'
import {
  SessionReportRepository,
  type SessionReportRepositoryShape,
} from '../../ports/session-report-repository'
import { publishControlResponse } from '../session-control-event-projection'
import { submitSessionReport } from '../session-report-service'

const { publishSessionHostEventMock } = vi.hoisted(() => ({
  publishSessionHostEventMock: vi.fn(),
}))

vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: publishSessionHostEventMock,
}))

const RESPONSE = {
  contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
  requestId: 'request-report',
  idempotencyKey: 'idempotency-report',
  replayed: false,
  outcome: {
    operation: 'report',
    effect: 'accepted-report',
    sessionId: 'session-worker',
    reportId: 'report-next',
    correlationId: 'correlation-next',
    targetSessionIds: ['session-parent', 'session-peer'],
    deliveryStates: [
      { sessionId: 'session-parent', status: 'pending' },
      { sessionId: 'session-peer', status: 'pending' },
    ],
  },
} as const satisfies SessionControlMutationResponse

describe('Session report event projection', () => {
  beforeEach(() => {
    publishSessionHostEventMock.mockReset()
  })

  it('publishes one list update per report target through the command projection', async () => {
    const deliverPendingToActiveRun = vi.fn(() => Effect.succeed(false))
    const repository = fromPartial<SessionReportRepositoryShape>({
      execute: () => Effect.succeed(RESPONSE),
    })
    const delivery = fromPartial<SessionReportDeliveryServiceShape>({
      deliverPendingToActiveRun,
    })
    const layer = Layer.mergeAll(
      Layer.succeed(SessionControlIdentityService, {
        nextRunId: Effect.succeed(RunId('run-unused')),
        nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
        nextReportId: Effect.succeed(ReportId('report-next')),
        nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-next')),
        now: Effect.succeed(1234),
      }),
      Layer.succeed(SessionReportRepository, repository),
      Layer.succeed(SessionReportDeliveryService, delivery),
    )

    const response = await Effect.runPromise(
      submitSessionReport({
        callerId: 'local-user',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-report',
          idempotencyKey: 'idempotency-report',
          command: {
            operation: 'report',
            sessionId: 'session-worker',
            target: { type: 'sessions', sessionIds: ['session-parent', 'session-peer'] },
            input: { text: 'Ready for integration.', requestReply: false },
          },
        },
      }).pipe(Effect.provide(layer)),
    )
    publishControlResponse(response)

    expect(deliverPendingToActiveRun).toHaveBeenCalledTimes(2)
    expect(publishSessionHostEventMock.mock.calls).toEqual([
      [
        {
          kind: 'session-list-changed',
          sessionId: 'session-parent',
          change: 'updated',
        },
      ],
      [
        {
          kind: 'session-list-changed',
          sessionId: 'session-peer',
          change: 'updated',
        },
      ],
    ])
  })
})
