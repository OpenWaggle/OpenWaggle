import { describe, expect, it } from 'vitest'
import { buildSessionsToolPayload } from '../sessions-tool-payload'

describe('Pi Sessions tool report waits', () => {
  it('builds target-scoped delivery and correlated reply waits', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'wait',
          sessionIds: ['worker-1'],
          condition: 'report-delivered',
          reportId: 'report-1',
          timeoutMs: 30_000,
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({
      request: {
        query: {
          targets: [{ sessionId: 'worker-1', condition: 'report-delivered', reportId: 'report-1' }],
        },
      },
    })
    expect(
      buildSessionsToolPayload(
        {
          action: 'wait',
          sessionIds: ['session-queen'],
          condition: 'correlated-reply',
          correlationId: 'correlation-1',
          timeoutMs: 30_000,
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({
      request: {
        query: {
          targets: [
            {
              sessionId: 'session-queen',
              condition: 'correlated-reply',
              correlationId: 'correlation-1',
            },
          ],
        },
      },
    })
  })

  it('requires the identifier selected by each report wait condition', () => {
    expect(() =>
      buildSessionsToolPayload(
        {
          action: 'wait',
          sessionIds: ['worker-1'],
          condition: 'report-delivered',
          timeoutMs: 30_000,
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toThrow('reportId')
    expect(() =>
      buildSessionsToolPayload(
        {
          action: 'wait',
          sessionIds: ['session-queen'],
          condition: 'correlated-reply',
          timeoutMs: 30_000,
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toThrow('correlationId')
  })
})
