import { describe, expect, it } from 'vitest'
import { resolveLocalSessionCommandTimeoutMs } from '../local-session-client'

describe('Local Session client command timeout', () => {
  it('keeps long-poll transport timeouts beyond the requested Session wait', () => {
    expect(
      resolveLocalSessionCommandTimeoutMs({
        contract: 'session-query-v2',
        request: {
          contractVersion: 2,
          requestId: 'request-wait',
          query: {
            operation: 'wait',
            targets: [{ sessionId: 'session-target', condition: 'idle' }],
            timeoutMs: 300_000,
          },
        },
      }),
    ).toBe(305_000)
  })

  it('does not impose an arbitrary response timeout on explicit Waggle', () => {
    expect(
      resolveLocalSessionCommandTimeoutMs({
        contract: 'session-waggle-v1',
        request: {
          contractVersion: 1,
          requestId: 'request-waggle',
          idempotencyKey: 'idempotency-waggle',
          sessionId: 'session-target',
          payload: { text: 'Review.', thinkingLevel: 'medium', attachments: [] },
          model: 'openai/gpt-5.4',
          config: {
            mode: 'sequential',
            agents: [
              { label: 'Architect', model: '$inherit', roleDescription: 'Plans', color: 'blue' },
              {
                label: 'Reviewer',
                model: 'openai/gpt-5.4',
                roleDescription: 'Reviews',
                color: 'amber',
              },
            ],
            stop: { primary: 'consensus', maxTurnsSafety: 4 },
          },
        },
      }),
    ).toBeUndefined()
  })

  it('does not impose an arbitrary response timeout on owner-routed manual compaction', () => {
    expect(
      resolveLocalSessionCommandTimeoutMs({
        contract: 'local-compaction-v1',
        request: {
          requestId: 'request-compaction',
          sessionId: 'session-target',
          model: 'openai/gpt-5.5',
        },
      }),
    ).toBeUndefined()
  })
})
