import { describe, expect, it } from 'vitest'
import {
  decideSessionHostEvent,
  isSessionHostEventEnvelope,
} from '../local-session-event-validation'

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

/*
 * A failed subscription resubscribes after the same cursor and gets the same event again, so one
 * event this client cannot decode used to stop every Session's live events.
 */
describe('decideSessionHostEvent', () => {
  it('relays a valid event as it is', () => {
    const envelope = transportEnvelope('session-transport', userMessageStart)
    expect(decideSessionHostEvent(envelope)).toEqual({
      action: 'relay',
      envelope,
      droppedUserMessage: false,
    })
  })

  it.each(['session-transport', 'session-waggle-transport'] as const)(
    'relays a message start on %s without the user message it cannot decode',
    (kind) => {
      const userMessage = { ...userMessageStart.userMessage, content: 'raw' }
      const decision = decideSessionHostEvent(
        transportEnvelope(kind, { ...userMessageStart, userMessage }),
      )
      const { userMessage: _dropped, ...event } = userMessageStart
      expect(decision).toEqual({
        action: 'relay',
        envelope: transportEnvelope(kind, event),
        droppedUserMessage: true,
      })
    },
  )

  it('skips past an event it cannot decode', () => {
    const unknownKind = {
      cursor: { hostInstanceId: 'host-1', sequence: 7 },
      timestamp: 10,
      payload: { kind: 'session-from-a-later-host', sessionId: 'session-1' },
    }
    expect(decideSessionHostEvent(unknownKind)).toEqual({
      action: 'skip',
      cursor: { hostInstanceId: 'host-1', sequence: 7 },
    })
  })

  it('cannot skip an event that has no cursor', () => {
    expect(decideSessionHostEvent({ timestamp: 1, payload: {} })).toEqual({ action: 'invalid' })
    expect(decideSessionHostEvent('event')).toEqual({ action: 'invalid' })
  })
})
