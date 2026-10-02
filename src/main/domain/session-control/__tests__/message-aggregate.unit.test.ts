import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { applyAdaptiveMessage } from '../message-aggregate'

describe('Session Control adaptive Message aggregate', () => {
  it('accepts an idle Session message as one durable starting Run with its settings', () => {
    const sessionId = SessionId('session-target')
    const runId = RunId('run-next')
    const intent = {
      text: 'Implement the target schema.',
      attachmentIds: [],
      callerId: 'local-user',
      acceptedAt: 1234,
      idempotencyKey: 'message-one',
    } as const

    const result = applyAdaptiveMessage({
      state: {
        sessionId,
        revision: 7,
        run: { state: 'idle' },
        followUpQueue: { state: 'running', revision: 3, items: [] },
      },
      identities: { runId, followUpId: FollowUpId('follow-up-unused') },
      intent,
      runSettings: { thinkingLevel: 'high', runAuthorizationOverride: 'yolo' },
    })

    expect(result).toEqual({
      accepted: true,
      state: {
        sessionId,
        revision: 8,
        run: {
          state: 'starting',
          runId,
          intent: { ...intent, thinkingLevel: 'high', runAuthorizationOverride: 'yolo' },
        },
        followUpQueue: { state: 'running', revision: 3, items: [] },
      },
      outcome: {
        operation: 'message',
        effect: 'started-run',
        sessionId,
        runId,
        stateRevision: 8,
      },
    })
  })

  it('accepts a message during a Run as one durable Follow-up', () => {
    const sessionId = SessionId('session-target')
    const activeRunId = RunId('run-active')
    const followUpId = FollowUpId('follow-up-next')
    const intent = {
      text: 'Run the integration checks afterward.',
      attachmentIds: ['attachment-plan'],
      callerId: 'local-user',
      acceptedAt: 2345,
      idempotencyKey: 'message-two',
    } as const

    const result = applyAdaptiveMessage({
      state: {
        sessionId,
        revision: 9,
        run: { state: 'active', runId: activeRunId },
        followUpQueue: { state: 'running', revision: 4, items: [] },
      },
      identities: { runId: RunId('run-unused'), followUpId },
      intent,
    })

    expect(result).toEqual({
      accepted: true,
      state: {
        sessionId,
        revision: 10,
        run: { state: 'active', runId: activeRunId },
        followUpQueue: {
          state: 'running',
          revision: 5,
          items: [{ id: followUpId, intent, deliveryState: 'pending' }],
        },
      },
      outcome: {
        operation: 'message',
        effect: 'queued-follow-up',
        sessionId,
        followUpId,
        queueRevision: 5,
        stateRevision: 10,
      },
    })
  })

  it.each([
    [{ thinkingLevel: 'high' }, 'thinking_level_requires_idle_session'],
    [{ runAuthorizationOverride: 'yolo' }, 'run_authorization_override_requires_idle_session'],
  ] as const)('refuses Session settings on a message that would be queued', (runSettings, code) => {
    const state = {
      sessionId: SessionId('session-target'),
      revision: 9,
      run: { state: 'active', runId: RunId('run-active') },
      followUpQueue: { state: 'running', revision: 4, items: [] },
    } as const

    const result = applyAdaptiveMessage({
      state,
      identities: { runId: RunId('run-unused'), followUpId: FollowUpId('follow-up-next') },
      intent: {
        text: 'Later, think harder.',
        attachmentIds: [],
        callerId: 'local-user',
        acceptedAt: 2345,
        idempotencyKey: 'message-three',
      },
      runSettings,
    })

    expect(result).toEqual({ accepted: false, code, state })
  })
})
