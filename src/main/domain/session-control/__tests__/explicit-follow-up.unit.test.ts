import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { applyExplicitFollowUp } from '../explicit-follow-up'

describe('Session Control explicit Follow-up', () => {
  it('queues one future Run without changing the active Run', () => {
    const sessionId = SessionId('session-target')
    const activeRunId = RunId('run-active')
    const followUpId = FollowUpId('follow-up-next')
    const intent = {
      text: 'Run the verification matrix next.',
      attachmentIds: [],
      runAuthorizationOverride: 'ask-for-approval',
      callerId: 'local-user',
      acceptedAt: 3456,
      idempotencyKey: 'follow-up-one',
    } as const

    const result = applyExplicitFollowUp({
      state: {
        sessionId,
        revision: 6,
        run: { state: 'active', runId: activeRunId },
        followUpQueue: { state: 'running', revision: 3, items: [] },
      },
      followUpId,
      intent,
    })

    expect(result).toEqual({
      accepted: true,
      state: {
        sessionId,
        revision: 7,
        run: { state: 'active', runId: activeRunId },
        followUpQueue: {
          state: 'running',
          revision: 4,
          items: [{ id: followUpId, intent, deliveryState: 'pending' }],
        },
      },
      outcome: {
        operation: 'follow-up',
        effect: 'queued-follow-up',
        sessionId,
        followUpId,
        queueRevision: 4,
        stateRevision: 7,
      },
    })
  })
})
