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
      runId: RunId('run-next'),
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
        queueState: 'running',
        queueRevision: 4,
        stateRevision: 7,
      },
    })
  })

  it('tells the caller when an idle Session queues the Follow-up behind a paused queue', () => {
    const result = applyExplicitFollowUp({
      state: {
        sessionId: SessionId('session-target'),
        revision: 2,
        run: { state: 'idle' },
        followUpQueue: { state: 'paused', revision: 1, items: [], pauseReason: 'host-lost' },
      },
      runId: RunId('run-next'),
      followUpId: FollowUpId('follow-up-next'),
      intent: {
        text: 'Continue.',
        attachmentIds: [],
        callerId: 'session-agent:queen',
        acceptedAt: 10,
        idempotencyKey: 'follow-up-paused',
      },
    })

    expect(result).toMatchObject({
      accepted: true,
      outcome: {
        effect: 'queued-follow-up',
        queueState: 'paused',
        pauseReason: 'host-lost',
      },
    })
  })

  // The person's work never waits behind agents' work held back by a full limit.
  it.each([
    ['starts the person’s', 'gui:local-user', 'parent-limit', 'started-run'],
    ['queues an agent’s', 'session-agent:queen:run-queen', 'parent-limit', 'queued-follow-up'],
    ['queues the person’s', 'gui:local-user', 'requested', 'queued-follow-up'],
  ] as const)(
    '%s Follow-up in an idle Session paused for %s',
    (_, callerId, pauseReason, effect) => {
      const agentItem = {
        id: FollowUpId('agent-held'),
        deliveryState: 'pending' as const,
        intent: {
          text: 'Agent work',
          attachmentIds: [],
          callerId: 'session-agent:queen:run-queen',
          acceptedAt: 1,
          idempotencyKey: 'agent',
        },
      }
      const result = applyExplicitFollowUp({
        state: {
          sessionId: SessionId('session-target'),
          revision: 2,
          run: { state: 'idle' },
          followUpQueue: { state: 'paused', revision: 1, items: [agentItem], pauseReason },
        },
        runId: RunId('run-next'),
        followUpId: FollowUpId('follow-up-next'),
        intent: {
          text: 'Mine',
          attachmentIds: [],
          callerId,
          acceptedAt: 2,
          idempotencyKey: 'mine',
        },
      })

      if (!result.accepted) throw new Error(result.code)
      expect(result.outcome.effect).toBe(effect)
      expect(result.state.followUpQueue).toMatchObject({ state: 'paused', pauseReason })
      expect(result.state.followUpQueue.items[0]?.id).toBe('agent-held')
    },
  )
})
