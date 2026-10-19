import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { promoteSessionFollowUp } from '../session-control-promotion-service'
import { makePromotionReplacementLayer } from './session-control-promotion-replacement.test-support'

describe('Session Control promotion recorded outcome', () => {
  it('keeps the Follow-up attachments when the journal already recorded the promotion as rejected', async () => {
    // Host-loss recovery can complete a pending promotion row as `host_lost` while its steer was
    // still accepted here. The recorded outcome is what the Session keeps: the Follow-up stays
    // queued, so its attachments must stay too.
    const setup = makePromotionReplacementLayer({
      sessionId: SessionId('session-target'),
      revision: 5,
      run: { state: 'active', runId: RunId('run-active') },
      followUpQueue: {
        state: 'running',
        revision: 2,
        items: [
          {
            id: FollowUpId('follow-up-next'),
            deliveryState: 'pending',
            intent: {
              text: 'Steer this now.',
              attachmentIds: ['attachment-kept'],
              callerId: 'local-user',
              acceptedAt: 1000,
              idempotencyKey: 'follow-up',
            },
          },
        ],
      },
    })
    const recordedElsewhere = Layer.succeed(SessionControlOperationJournal, {
      claim: (input) =>
        Effect.sync(() => {
          input.decide(setup.state())
          return { status: 'claimed', stateRevision: 5 } as const
        }),
      complete: () =>
        Effect.succeed({
          operation: 'promote',
          effect: 'rejected',
          sessionId: 'session-target',
          code: 'host_lost',
        } as const),
    })

    const response = await Effect.runPromise(
      promoteSessionFollowUp({
        callerId: 'local-user',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-promote',
          idempotencyKey: 'idempotency-promote',
          command: {
            operation: 'promote',
            sessionId: 'session-target',
            expectedRunId: 'run-active',
            followUpId: 'follow-up-next',
          },
        },
      }).pipe(Effect.provide(Layer.merge(setup.layer, recordedElsewhere))),
    )

    expect(setup.steer).toHaveBeenCalledOnce()
    expect(response.outcome).toMatchObject({ effect: 'rejected', code: 'host_lost' })
    expect(setup.release).not.toHaveBeenCalled()
  })
})
