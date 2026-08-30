import { describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { pumpLocalSessionSubscription } from '../local-session-subscription-pump'

describe('Local Session subscription pump', () => {
  it('forwards payload-free cursor advances without asynchronous authorization', async () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-test' })
    const result = hub.subscribeAfter(
      hub.cursor(),
      (event) =>
        event.payload.kind !== 'semantic-discovery-readiness-changed' &&
        event.payload.sessionId === 'visible-session',
      { advanceFilteredCursor: true },
    )
    if (result.status !== 'ready') throw new Error('Expected a ready subscription.')
    const denied = hub.publish({
      kind: 'session-state-changed',
      sessionId: 'private-session',
      stateRevision: 1,
      operation: 'run-settled',
    })
    const visible = hub.publish({
      kind: 'session-state-changed',
      sessionId: 'visible-session',
      stateRevision: 1,
      operation: 'run-settled',
    })
    const sent: Readonly<Record<string, unknown>>[] = []
    const eventIsDenied = vi.fn(async () => false)
    let active = true

    await pumpLocalSessionSubscription({
      subscription: result.subscription,
      active: () => active,
      closed: () => false,
      eventIsDenied,
      send: async (frame) => {
        sent.push(frame)
        if (frame.kind === 'event') active = false
      },
    })

    expect(sent).toEqual([
      { kind: 'cursor-advanced', cursor: denied.cursor },
      { kind: 'event', event: visible },
    ])
    expect(eventIsDenied).toHaveBeenCalledTimes(1)
    expect(eventIsDenied).toHaveBeenCalledWith(visible)
  })

  it('advances a restricted client cursor across denied events', async () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-test' })
    const result = hub.subscribeAfter()
    if (result.status !== 'ready') throw new Error('Expected a ready subscription.')
    const denied = hub.publish({
      kind: 'session-state-changed',
      sessionId: 'private-session',
      stateRevision: 1,
      operation: 'run-settled',
    })
    const visible = hub.publish({
      kind: 'session-state-changed',
      sessionId: 'visible-session',
      stateRevision: 1,
      operation: 'run-settled',
    })
    const sent: Readonly<Record<string, unknown>>[] = []
    let active = true

    await pumpLocalSessionSubscription({
      subscription: result.subscription,
      active: () => active,
      closed: () => false,
      eventIsDenied: async (event) =>
        'sessionId' in event.payload && event.payload.sessionId === 'private-session',
      send: async (frame) => {
        sent.push(frame)
        if (frame.kind === 'event') active = false
      },
    })

    expect(sent).toEqual([
      { kind: 'cursor-advanced', cursor: denied.cursor },
      { kind: 'event', event: visible },
    ])
  })
})
