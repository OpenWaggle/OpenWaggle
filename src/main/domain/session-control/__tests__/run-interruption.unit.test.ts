import { RunId, SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { applyRunInterruption } from '../run-interruption'

describe('Session Control Run interruption', () => {
  it('moves only the expected active Run into stopping state', () => {
    const sessionId = SessionId('session-target')
    const runId = RunId('run-active')
    const result = applyRunInterruption({
      state: {
        sessionId,
        revision: 12,
        run: { state: 'active', runId },
        followUpQueue: { state: 'running', revision: 4, items: [] },
      },
      expectedRunId: runId,
    })

    expect(result).toEqual({
      accepted: true,
      state: {
        sessionId,
        revision: 13,
        run: { state: 'stopping', runId },
        followUpQueue: { state: 'running', revision: 4, items: [] },
      },
      outcome: {
        operation: 'interrupt',
        effect: 'interruption-requested',
        sessionId,
        runId,
        stateRevision: 13,
      },
    })
  })
})
