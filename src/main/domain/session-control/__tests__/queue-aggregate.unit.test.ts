import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { applyQueueMutation } from '../queue-aggregate'

describe('Session Control queue aggregate', () => {
  it('reorders the complete queue under its expected revision', () => {
    const first = {
      id: FollowUpId('follow-up-first'),
      intent: {
        text: 'First',
        attachmentIds: [],
        callerId: 'local-user',
        acceptedAt: 1000,
        idempotencyKey: 'first',
      },
      deliveryState: 'pending',
    } as const
    const second = {
      id: FollowUpId('follow-up-second'),
      intent: {
        text: 'Second',
        attachmentIds: [],
        callerId: 'local-user',
        acceptedAt: 2000,
        idempotencyKey: 'second',
      },
      deliveryState: 'pending',
    } as const
    const sessionId = SessionId('session-target')

    const result = applyQueueMutation({
      nextRunId: RunId('run-unused'),
      state: {
        sessionId,
        revision: 10,
        run: { state: 'idle' },
        followUpQueue: { state: 'running', revision: 5, items: [first, second] },
      },
      mutation: {
        type: 'reorder',
        expectedRevision: 5,
        orderedFollowUpIds: [second.id, first.id],
      },
    })

    expect(result).toEqual({
      accepted: true,
      state: {
        sessionId,
        revision: 11,
        run: { state: 'idle' },
        followUpQueue: { state: 'running', revision: 6, items: [second, first] },
      },
      outcome: {
        operation: 'queue-reorder',
        effect: 'queue-updated',
        sessionId,
        queueState: 'running',
        queueRevision: 6,
        followUpIds: [second.id, first.id],
        stateRevision: 11,
      },
    })
  })

  it('rebinds an authorization-blocked Follow-up to the authorized caller without resuming', () => {
    const sessionId = SessionId('session-target')
    const followUpId = FollowUpId('follow-up-blocked')
    const result = applyQueueMutation({
      nextRunId: RunId('run-unused'),
      state: {
        sessionId,
        revision: 4,
        run: { state: 'idle' },
        followUpQueue: {
          state: 'paused',
          revision: 8,
          items: [
            {
              id: followUpId,
              deliveryState: 'needs_attention',
              attentionReason: 'profile_revoked',
              intent: {
                text: 'Continue.',
                attachmentIds: [],
                callerId: 'profile:revoked',
                acceptedAt: 1000,
                idempotencyKey: 'blocked',
                runAuthorizationOverride: 'yolo',
              },
            },
          ],
        },
      },
      mutation: {
        type: 'update-authorization',
        followUpId,
        callerId: 'gui:local-user',
        runAuthorizationOverride: 'ask-for-approval',
      },
    })

    expect(result).toMatchObject({
      accepted: true,
      state: {
        followUpQueue: {
          state: 'paused',
          revision: 9,
          items: [
            {
              deliveryState: 'pending',
              intent: {
                callerId: 'gui:local-user',
                runAuthorizationOverride: 'ask-for-approval',
              },
            },
          ],
        },
      },
      outcome: { operation: 'queue-update-authorization' },
    })
  })

  it('atomically starts the pending head when an idle recovered queue resumes', () => {
    const sessionId = SessionId('session-target')
    const followUpId = FollowUpId('follow-up-recovered')
    const intent = {
      text: 'Continue after recovery.',
      attachmentIds: [],
      callerId: 'local-user',
      acceptedAt: 1000,
      idempotencyKey: 'recovered',
    }

    const result = applyQueueMutation({
      nextRunId: RunId('run-resumed'),
      state: {
        sessionId,
        revision: 4,
        run: { state: 'idle' },
        followUpQueue: {
          state: 'paused',
          revision: 8,
          items: [{ id: followUpId, deliveryState: 'pending', intent }],
        },
      },
      mutation: { type: 'resume', expectedRevision: 8 },
    })

    expect(result).toEqual({
      accepted: true,
      state: {
        sessionId,
        revision: 5,
        run: { state: 'starting', runId: RunId('run-resumed'), intent },
        followUpQueue: { state: 'running', revision: 10, items: [] },
      },
      outcome: {
        operation: 'queue-resume',
        effect: 'started-run',
        sessionId,
        runId: RunId('run-resumed'),
        followUpId,
        queueRevision: 10,
        stateRevision: 5,
      },
    })
  })
})
