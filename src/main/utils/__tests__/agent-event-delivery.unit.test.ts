import { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentEventDelivery,
  type AgentEventTarget,
  BACKGROUND_SESSION_FLUSH_MS,
  SHOWN_SESSION_FLUSH_MS,
} from '../agent-event-delivery'

const SHOWN = SessionId('shown')
const OTHER = SessionId('other')

function textDelta(delta: string, timestamp: number, messageId = 'm1'): AgentTransportEvent {
  return {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
    timestamp,
  }
}

function target(id = 1) {
  const sent: Array<{ readonly sessionId: SessionId; readonly event: AgentTransportEvent }> = []
  const value: AgentEventTarget = { id, send: (payload) => sent.push(payload) }
  return { value, sent }
}

describe('AgentEventDelivery', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends a frame of streamed tokens as one event', () => {
    const delivery = new AgentEventDelivery()
    const window = target()
    for (let index = 0; index < 10; index += 1) {
      delivery.deliver([window.value], SHOWN, textDelta(`t${String(index)} `, index))
    }
    expect(window.sent).toEqual([])

    vi.advanceTimersByTime(SHOWN_SESSION_FLUSH_MS)

    expect(window.sent).toEqual([
      { sessionId: SHOWN, event: textDelta('t0 t1 t2 t3 t4 t5 t6 t7 t8 t9 ', 9) },
    ])
  })

  it('delivers any other event after the deltas before it, in order', () => {
    const delivery = new AgentEventDelivery()
    const window = target()
    delivery.deliver([window.value], SHOWN, textDelta('Hello', 1))
    delivery.deliver([window.value], SHOWN, textDelta(' there', 2))
    delivery.deliver([window.value], SHOWN, {
      type: 'message_end',
      messageId: 'm1',
      role: 'assistant',
      timestamp: 3,
    })

    expect(window.sent.map((payload) => payload.event.type)).toEqual([
      'message_update',
      'message_end',
    ])
    expect(window.sent[0]?.event).toEqual(textDelta('Hello there', 2))
  })

  it('does not merge deltas of different parts', () => {
    const delivery = new AgentEventDelivery()
    const window = target()
    delivery.deliver([window.value], SHOWN, textDelta('a', 1))
    delivery.deliver([window.value], SHOWN, {
      type: 'message_update',
      messageId: 'm1',
      role: 'assistant',
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 1, delta: 'b' },
      timestamp: 2,
    })
    delivery.deliver([window.value], SHOWN, textDelta('c', 3, 'm2'))
    vi.advanceTimersByTime(SHOWN_SESSION_FLUSH_MS)

    expect(window.sent).toHaveLength(3)
  })

  it('sends pending deltas before a message on another channel', () => {
    const delivery = new AgentEventDelivery()
    const window = target()
    delivery.deliver([window.value], SHOWN, textDelta('last words', 1))

    delivery.flushAll([window.value])

    expect(window.sent).toEqual([{ sessionId: SHOWN, event: textDelta('last words', 1) }])
    vi.advanceTimersByTime(BACKGROUND_SESSION_FLUSH_MS)
    expect(window.sent).toHaveLength(1)
  })

  it('delivers a Session the window does not show on a slower beat, without losing text', () => {
    const delivery = new AgentEventDelivery()
    const window = target()
    delivery.setShownSessions(window.value.id, [SHOWN])
    delivery.deliver([window.value], OTHER, textDelta('background ', 1))
    vi.advanceTimersByTime(SHOWN_SESSION_FLUSH_MS)
    delivery.deliver([window.value], OTHER, textDelta('text', 2))
    expect(window.sent).toEqual([])

    vi.advanceTimersByTime(BACKGROUND_SESSION_FLUSH_MS)

    expect(window.sent).toEqual([{ sessionId: OTHER, event: textDelta('background text', 2) }])
  })

  it('merges tool input deltas only in the same form', () => {
    const delivery = new AgentEventDelivery()
    const window = target()
    const toolDelta = (delta: string, input?: string): AgentTransportEvent => ({
      type: 'message_update',
      messageId: 'm1',
      role: 'assistant',
      assistantMessageEvent: {
        type: 'toolcall_delta',
        contentIndex: 2,
        toolCallId: 'call',
        delta,
        ...(input === undefined ? {} : { input }),
      },
      timestamp: 1,
    })
    delivery.deliver([window.value], SHOWN, toolDelta('{"a"', '{}'))
    delivery.deliver([window.value], SHOWN, toolDelta(':1}', '{"a":1}'))
    delivery.deliver([window.value], SHOWN, toolDelta(' raw'))
    vi.advanceTimersByTime(SHOWN_SESSION_FLUSH_MS)

    expect(window.sent.map((payload) => payload.event)).toEqual([
      toolDelta('{"a":1}', '{"a":1}'),
      toolDelta(' raw'),
    ])
  })

  it('flushes only the named Session on a stream buffer read', () => {
    const delivery = new AgentEventDelivery()
    const window = target()
    delivery.setShownSessions(window.value.id, [SHOWN])
    delivery.deliver([window.value], OTHER, textDelta('background', 1))
    delivery.deliver([window.value], SHOWN, textDelta('shown', 2))

    delivery.flushSession([window.value], OTHER)

    expect(window.sent).toEqual([{ sessionId: OTHER, event: textDelta('background', 1) }])
    vi.advanceTimersByTime(BACKGROUND_SESSION_FLUSH_MS)
    expect(window.sent).toEqual([
      { sessionId: OTHER, event: textDelta('background', 1) },
      { sessionId: SHOWN, event: textDelta('shown', 2) },
    ])
  })

  it('forgets a closed window', () => {
    const delivery = new AgentEventDelivery()
    const window = target()
    delivery.deliver([window.value], SHOWN, textDelta('never sent', 1))
    delivery.forgetTarget(window.value.id)
    vi.advanceTimersByTime(BACKGROUND_SESSION_FLUSH_MS)
    expect(window.sent).toEqual([])
  })
})
