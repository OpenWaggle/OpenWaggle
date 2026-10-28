import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import { describe, expect, it } from 'vitest'
import { encodeLocalSessionPayload } from '../../session-host/local-session-framing'
import { SerializedLocalSessionFrame } from '../../session-host/local-session-serialized-frame'
import { SessionHostEventHub } from '../session-host-event-hub'
import {
  appendJsonProperty,
  serializeSessionHostEvent,
  sessionHostEventJson,
} from '../session-host-event-serialization'

/** A payload that counts how often it is serialized. */
function countingEvent(): { event: SessionHostEventEnvelope; serializations: () => number } {
  let count = 0
  const payload = {
    kind: 'session-list-changed',
    sessionId: 'session-1',
    change: 'updated',
    toJSON() {
      count += 1
      return { kind: this.kind, sessionId: this.sessionId, change: this.change }
    },
  } as const
  return {
    event: { cursor: { hostInstanceId: 'host', sequence: 1 }, timestamp: 2, payload },
    serializations: () => count,
  }
}

describe('Session Host event serialization', () => {
  it('serializes an event exactly as JSON.stringify does', () => {
    const { event } = countingEvent()
    expect(serializeSessionHostEvent(event)).toBe(JSON.stringify(event))
    expect(appendJsonProperty('{"a":1}', 'b', '[2]')).toBe('{"a":1,"b":[2]}')
  })

  it('frames a published event for each subscriber without serializing its payload again', () => {
    const { event, serializations } = countingEvent()
    const hub = new SessionHostEventHub({ hostInstanceId: 'host', now: () => 2 })
    const published = hub.publish(event.payload)
    expect(serializations()).toBe(1)

    // A subscriber's cursor is projected, so the envelope is a copy around the same payload.
    const exposed = { ...published, cursor: { hostInstanceId: 'host.caller', sequence: 1 } }
    const frame = new SerializedLocalSessionFrame(
      'event',
      appendJsonProperty(
        JSON.stringify({ kind: 'event', subscriptionId: 'sub' }),
        'event',
        sessionHostEventJson(exposed),
      ),
    )

    const decoded: unknown = JSON.parse(encodeLocalSessionPayload(frame).toString('utf8'))
    expect(serializations()).toBe(1)
    expect(decoded).toEqual(
      JSON.parse(JSON.stringify({ kind: 'event', subscriptionId: 'sub', event: exposed })),
    )
  })
})
