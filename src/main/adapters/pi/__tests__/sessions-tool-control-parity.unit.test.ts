import { fromAny } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { buildSessionsToolPayload } from '../sessions-tool-extension'

describe('Pi-native Sessions control parity', () => {
  it.each([{ action: 'message' as const }, { action: 'start' as const }])(
    'maps thinking and attachments for a Run-starting $action',
    (operation) => {
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
    },
  )

  it.each([
    { action: 'follow_up' as const },
    { action: 'replace' as const, expectedRunId: 'run-worker' },
    { action: 'steer' as const, expectedRunId: 'run-worker' },
  ])('refuses Session settings on $action, which acts on an active Run', (operation) => {
    const base = { ...operation, sessionId: 'session-worker', text: 'Use the supplied evidence.' }
    expect(() =>
      buildSessionsToolPayload(fromAny({ ...base, thinking: 'high' }), {
        sessionId: 'session-queen',
        runId: 'run-current',
      }),
    ).toThrow('thinking_level_requires_idle_session')
    expect(() =>
      buildSessionsToolPayload(fromAny({ ...base, authorization: 'yolo' }), {
        sessionId: 'session-queen',
        runId: 'run-current',
      }),
    ).toThrow('run_authorization_override_requires_idle_session')
    expect(
      buildSessionsToolPayload(base, { sessionId: 'session-queen', runId: 'run-current' }),
    ).toMatchObject({ request: { command: { input: { text: 'Use the supplied evidence.' } } } })
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
