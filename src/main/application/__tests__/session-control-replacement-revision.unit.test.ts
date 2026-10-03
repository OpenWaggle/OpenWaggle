import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { returnUndeliveredSteers } from '../../domain/session-control/undelivered-steering'
import { replaceSessionRun } from '../session-control-replacement-service'
import { makePromotionReplacementLayer } from './session-control-promotion-replacement.test-support'

const returnedSteer = {
  id: FollowUpId('follow-up-returned-steer'),
  deliveryState: 'pending' as const,
  intent: {
    text: 'Also check the rollback.',
    attachmentIds: [],
    callerId: 'session-agent:queen',
    acceptedAt: 1500,
    idempotencyKey: 'steer-key',
    returnedSteer: { runId: 'run-active' },
  },
}

describe('Session Control Run replacement revision', () => {
  it('reports the revision it produced after the interrupted Run returned its steers', async () => {
    const setup = makePromotionReplacementLayer(
      {
        sessionId: SessionId('session-target'),
        revision: 7,
        run: { state: 'active', runId: RunId('run-active') },
        followUpQueue: { state: 'running', revision: 0, items: [] },
      },
      {
        // The interrupted Run settles while the replacement waits, returning its steer.
        interrupt: () =>
          Effect.sync(() => {
            setup.updateState((state) =>
              returnUndeliveredSteers(state, [
                { delivery: { kind: 'steer', followUp: returnedSteer }, handedOff: true },
              ]),
            )
            return { accepted: true } as const
          }),
      },
    )

    const response = await Effect.runPromise(
      replaceSessionRun({
        callerId: 'local-user',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-replace',
          idempotencyKey: 'idempotency-replace',
          command: {
            operation: 'replace',
            sessionId: 'session-target',
            expectedRunId: 'run-active',
            input: { text: 'Use the replacement.', attachmentIds: [] },
          },
        },
      }).pipe(Effect.provide(setup.layer)),
    )

    // Claim 7 -> 8 (stopping), returned steers 8 -> 9, replacement 9 -> 10.
    expect(setup.state()).toMatchObject({
      revision: 10,
      run: { state: 'starting', runId: RunId('run-replacement') },
      followUpQueue: { items: [returnedSteer] },
    })
    expect(response.outcome).toMatchObject({ effect: 'replaced-run', stateRevision: 10 })
  })
})
