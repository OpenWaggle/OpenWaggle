import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { applyAcceptedFollowUpPromotion, planFollowUpPromotion } from '../follow-up-promotion'

describe('Session Control Follow-up promotion', () => {
  it('promotes only the selected Follow-up and removes it after steering is accepted', () => {
    const runId = RunId('run-active')
    const selectedFollowUpId = FollowUpId('follow-up-selected')

    const plan = planFollowUpPromotion({
      requestedRunId: runId,
      followUpId: selectedFollowUpId,
      run: { state: 'active', runId, acceptsSteering: true },
      followUpQueue: {
        items: [FollowUpId('follow-up-first'), selectedFollowUpId, FollowUpId('follow-up-last')],
      },
    })

    expect(plan).toEqual({
      accepted: true,
      action: 'promote-follow-up',
      runId,
      followUpId: selectedFollowUpId,
      removal: 'after-steering-accepted',
    })
  })

  it('removes only the accepted Follow-up after Pi accepts steering', () => {
    const promoted = applyAcceptedFollowUpPromotion(
      {
        sessionId: SessionId('session-target'),
        revision: 5,
        run: { state: 'active', runId: RunId('run-active') },
        followUpQueue: {
          state: 'running',
          revision: 2,
          items: [
            {
              id: FollowUpId('follow-up-promoted'),
              deliveryState: 'pending',
              intent: {
                text: 'Steer this now.',
                attachmentIds: [],
                callerId: 'local-user',
                acceptedAt: 1000,
                idempotencyKey: 'promote',
              },
            },
          ],
        },
      },
      RunId('run-active'),
      FollowUpId('follow-up-promoted'),
    )

    expect(promoted).toMatchObject({
      revision: 6,
      followUpQueue: { revision: 3, items: [] },
    })
  })
})
