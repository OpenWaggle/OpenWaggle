import { describe, expect, it } from 'vitest'
import { isSessionHostEventEnvelope } from '../local-session-event-validation'

function transportEnvelope(kind: 'session-transport' | 'session-waggle-transport', event: unknown) {
  return {
    cursor: { hostInstanceId: 'host-1', sequence: 1 },
    timestamp: 10,
    payload: {
      kind,
      sessionId: 'session-1',
      event,
      ...(kind === 'session-waggle-transport' ? { meta: { agentIndex: 0 } } : {}),
    },
  }
}

const userMessageStart = {
  type: 'message_start',
  messageId: 'live-user',
  role: 'user',
  userMessage: {
    parts: [{ type: 'text', text: 'Queued question' }],
    sessionNodeCreatedOrder: 4,
    durableTextSha256: 'a'.repeat(64),
  },
  timestamp: 1,
}

describe('Local Session transport event validation', () => {
  it.each(['session-transport', 'session-waggle-transport'] as const)(
    'accepts an incorporated user message on %s',
    (kind) => {
      expect(isSessionHostEventEnvelope(transportEnvelope(kind, userMessageStart))).toBe(true)
    },
  )

  it.each([
    ['model input', { ...userMessageStart.userMessage, parts: [{ type: 'image', data: 'x' }] }],
    ['a negative log order', { ...userMessageStart.userMessage, sessionNodeCreatedOrder: -1 }],
    ['an unknown field', { ...userMessageStart.userMessage, content: 'raw' }],
  ])('rejects a user message carrying %s', (_case, userMessage) => {
    expect(
      isSessionHostEventEnvelope(
        transportEnvelope('session-transport', { ...userMessageStart, userMessage }),
      ),
    ).toBe(false)
  })

  it('rejects user content on a message that is not a user message', () => {
    expect(
      isSessionHostEventEnvelope(
        transportEnvelope('session-transport', { ...userMessageStart, role: 'assistant' }),
      ),
    ).toBe(false)
  })

  it('accepts transport events without user content as before', () => {
    expect(
      isSessionHostEventEnvelope(
        transportEnvelope('session-transport', {
          type: 'message_start',
          messageId: 'assistant-1',
          role: 'assistant',
          timestamp: 1,
        }),
      ),
    ).toBe(true)
  })
})
