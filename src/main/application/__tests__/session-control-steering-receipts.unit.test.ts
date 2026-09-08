import type { AgentSteerDeliveryReceipt } from '@shared/types/agent'
import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationOutcome,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import type { SessionControlSessionState } from '../../domain/session-control/message-aggregate'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { steerSessionRun } from '../session-control-external-service'
import { promoteSessionFollowUp } from '../session-control-promotion-service'

const receipts: readonly AgentSteerDeliveryReceipt[] = [
  { delivery: 'queued', durableTextSha256: 'b'.repeat(64), minimumCreatedOrder: 17 },
  { delivery: 'handled' },
]

function receiptLayer(receipt: AgentSteerDeliveryReceipt) {
  let completedOutcome: SessionControlMutationOutcome | undefined
  let state: SessionControlSessionState = {
    sessionId: SessionId('session-target'),
    revision: 7,
    run: { state: 'active', runId: RunId('run-active') },
    followUpQueue: {
      state: 'running',
      revision: 1,
      items: [
        {
          id: FollowUpId('follow-up-next'),
          deliveryState: 'pending',
          intent: {
            text: '/review',
            attachmentIds: [],
            callerId: 'caller',
            acceptedAt: 1,
            idempotencyKey: 'queued',
          },
        },
      ],
    },
  }
  const steer = vi.fn(() => Effect.succeed({ accepted: true as const, receipt }))
  const layer = Layer.mergeAll(
    Layer.succeed(AgentSteeringService, { steer }),
    Layer.succeed(SessionControlAttachmentService, {
      prepare: () => Effect.succeed([]),
      bind: () => Effect.void,
      cleanupUnreferenced: () => Effect.void,
      resolve: () => Effect.succeed([]),
      release: () => Effect.void,
    }),
    Layer.succeed(SessionControlOperationJournal, {
      claim: (input) =>
        Effect.sync(() => {
          if (completedOutcome)
            return { status: 'completed', replayed: true, outcome: completedOutcome } as const
          const decision = input.decide(state)
          if (!decision.accepted)
            return { status: 'completed', replayed: false, outcome: decision.outcome } as const
          return { status: 'claimed', stateRevision: state.revision } as const
        }),
      complete: (input) =>
        Effect.sync(() => {
          completedOutcome = input.outcome
          if (input.finalizeState) state = input.finalizeState(state)
        }),
    }),
  )
  return { layer, steer, completedOutcome: () => completedOutcome }
}

describe.each(['steer', 'promote'] as const)('%s delivery receipts', (operation) => {
  it.each(receipts)(
    'preserves the $delivery receipt in the outcome and idempotent replay',
    async (receipt) => {
      const setup = receiptLayer(receipt)
      const envelope = {
        contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
        requestId: 'request',
        idempotencyKey: 'idempotency',
      }
      const effect =
        operation === 'steer'
          ? steerSessionRun({
              callerId: 'caller',
              request: {
                ...envelope,
                command: {
                  operation,
                  sessionId: 'session-target',
                  expectedRunId: 'run-active',
                  input: { text: '/review', attachmentIds: [] },
                },
              },
            })
          : promoteSessionFollowUp({
              callerId: 'caller',
              request: {
                ...envelope,
                command: {
                  operation,
                  sessionId: 'session-target',
                  expectedRunId: 'run-active',
                  followUpId: 'follow-up-next',
                },
              },
            })
      const run = () => Effect.runPromise(effect.pipe(Effect.provide(setup.layer)))

      const response = await run()
      expect(response.outcome).toMatchObject({ operation, runId: 'run-active', receipt })
      expect(setup.completedOutcome()).toEqual(response.outcome)
      expect(await run()).toEqual({ ...response, replayed: true })
      expect(setup.steer).toHaveBeenCalledOnce()
    },
  )
})
