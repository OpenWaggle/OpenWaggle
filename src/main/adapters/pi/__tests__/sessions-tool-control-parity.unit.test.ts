import { describe, expect, it } from 'vitest'
import { buildSessionsToolPayload } from '../sessions-tool-extension'

describe('Pi-native Sessions control parity', () => {
  it.each([
    { action: 'message' as const },
    { action: 'start' as const },
    { action: 'follow_up' as const },
    { action: 'replace' as const, expectedRunId: 'run-worker' },
  ])('maps thinking and attachments for native control', (operation) => {
    const payload = buildSessionsToolPayload(
      {
        ...operation,
        sessionId: 'session-worker',
        text: 'Use the supplied evidence.',
        thinking: 'high',
        attachmentPaths: ['/repo/evidence.md'],
      },
      { sessionId: 'session-queen', runId: 'run-current' },
    )

    expect(payload).toMatchObject({
      contract: 'session-control-v2',
      transport: { attachmentPaths: ['/repo/evidence.md'] },
      request: { command: { input: { thinkingLevel: 'high' } } },
    })
  })

  it('rejects an unsupported native thinking level', () => {
    expect(() =>
      buildSessionsToolPayload(
        {
          action: 'message',
          sessionId: 'session-worker',
          text: 'Think differently.',
          thinking: 'impossible',
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toThrow('Unsupported thinking level: impossible')
  })
})
