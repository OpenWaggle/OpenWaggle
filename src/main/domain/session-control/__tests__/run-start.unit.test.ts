import { RunId, SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { applyRunStart } from '../run-start'

describe('Session Control explicit Run start', () => {
  it('starts one idle Session Run with its requested authorization override', () => {
    const sessionId = SessionId('session-target')
    const runId = RunId('run-next')
    const intent = {
      text: 'Implement the target schema.',
      attachmentIds: [],
      thinkingLevel: 'high',
      runAuthorizationOverride: 'yolo',
      callerId: 'local-user',
      acceptedAt: 1234,
      idempotencyKey: 'start-one',
    } as const

    const result = applyRunStart({
      state: {
        sessionId,
        revision: 4,
        run: { state: 'idle' },
        followUpQueue: { state: 'paused', revision: 2, items: [] },
      },
      runId,
      intent,
    })

    expect(result).toEqual({
      accepted: true,
      state: {
        sessionId,
        revision: 5,
        run: { state: 'starting', runId, intent },
        followUpQueue: { state: 'paused', revision: 2, items: [] },
      },
      outcome: {
        operation: 'start',
        effect: 'started-run',
        sessionId,
        runId,
        stateRevision: 5,
      },
    })
  })
})
