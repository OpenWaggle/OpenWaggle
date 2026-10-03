import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { MAX_FOLLOW_UP_QUEUE_ITEMS } from '@shared/types/session-control-queue'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import type {
  SessionControlFollowUp,
  SessionControlSessionState,
} from '../../domain/session-control/message-aggregate'
import { type AgentSteeringResult, AgentSteeringService } from '../../ports/agent-steering-service'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { steerSessionRun } from '../session-control-steering-service'
import { noUndeliveredSteers } from './agent-steering-test-layer'

function queued(index: number): SessionControlFollowUp {
  return {
    id: FollowUpId(`follow-up-${index}`),
    deliveryState: 'pending',
    intent: {
      text: `Queued ${index}.`,
      attachmentIds: [],
      callerId: 'local-user',
      acceptedAt: 1,
      idempotencyKey: `queued-${index}`,
    },
  }
}

function steerWithQueue(queueLength: number, result: AgentSteeringResult) {
  const state: SessionControlSessionState = {
    sessionId: SessionId('session-target'),
    revision: 3,
    run: { state: 'active', runId: RunId('run-active') },
    followUpQueue: {
      state: 'running',
      revision: 1,
      items: Array.from({ length: queueLength }, (_, index) => queued(index)),
    },
  }
  const steer = vi.fn(() => Effect.succeed(result))
  const layer = Layer.mergeAll(
    Layer.succeed(SessionControlOperationJournal, {
      claim: (input) =>
        Effect.sync(() => {
          const decision = input.decide(state)
          return decision.accepted
            ? ({ status: 'claimed', stateRevision: state.revision } as const)
            : ({ status: 'completed', replayed: false, outcome: decision.outcome } as const)
        }),
      complete: (input) => Effect.succeed(input.outcome),
    }),
    Layer.succeed(SessionControlAttachmentService, {
      prepare: () => Effect.succeed([]),
      bind: () => Effect.void,
      cleanupUnreferenced: () => Effect.void,
      resolve: () => Effect.succeed([]),
      release: () => Effect.void,
    }),
    Layer.succeed(AgentSteeringService, { steer, ...noUndeliveredSteers }),
    Layer.succeed(SessionControlIdentityService, {
      nextRunId: Effect.succeed(RunId('run-unused')),
      nextFollowUpId: Effect.succeed(FollowUpId('follow-up-returnable')),
      nextReportId: Effect.succeed(ReportId('report-unused')),
      nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
      now: Effect.succeed(1),
    }),
  )
  const response = Effect.runPromise(
    steerSessionRun({
      callerId: 'session-agent:queen',
      request: {
        contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
        requestId: 'request-steer',
        idempotencyKey: 'idempotency-steer',
        command: {
          operation: 'steer',
          sessionId: 'session-target',
          expectedRunId: 'run-active',
          input: { text: 'Steer.', attachmentIds: [] },
        },
      },
    }).pipe(Effect.provide(layer)),
  )
  return { response, steer }
}

const queuedReceipt: AgentSteeringResult = {
  accepted: true,
  receipt: { delivery: 'queued', durableTextSha256: 'a'.repeat(64), minimumCreatedOrder: 1 },
}

describe('direct steer capacity', () => {
  it('refuses a direct steer the full queue could not take back', async () => {
    const setup = steerWithQueue(MAX_FOLLOW_UP_QUEUE_ITEMS, queuedReceipt)
    await expect(setup.response).resolves.toMatchObject({
      outcome: { operation: 'steer', effect: 'rejected', code: 'queue_capacity_reached' },
    })
    expect(setup.steer).not.toHaveBeenCalled()
  })

  it('reports a Run that already holds as many returnable steers as it may', async () => {
    const setup = steerWithQueue(0, { accepted: false, code: 'steering_capacity_reached' })
    await expect(setup.response).resolves.toMatchObject({
      outcome: { effect: 'rejected', code: 'steering_capacity_reached' },
    })
  })

  it('records the steered Run as the provenance of the Follow-up it could become', async () => {
    const setup = steerWithQueue(MAX_FOLLOW_UP_QUEUE_ITEMS - 1, queuedReceipt)
    await expect(setup.response).resolves.toMatchObject({ outcome: { effect: 'steered-run' } })
    expect(setup.steer).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: {
          kind: 'steer',
          followUp: expect.objectContaining({
            intent: expect.objectContaining({
              callerId: 'session-agent:queen',
              idempotencyKey: 'idempotency-steer',
              returnedSteer: { runId: 'run-active' },
            }),
          }),
        },
      }),
    )
  })
})
