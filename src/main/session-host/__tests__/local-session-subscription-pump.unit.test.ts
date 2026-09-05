import { describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { pumpLocalSessionSubscription } from '../local-session-subscription-pump'

describe('Local Session subscription pump', () => {
  it('does not expose cursor advances for events filtered by the subscription', async () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-test' })
    const result = hub.subscribeAfter(
      hub.cursor(),
      (event) =>
        event.payload.kind !== 'semantic-discovery-readiness-changed' &&
        event.payload.sessionId === 'visible-session',
      { advanceFilteredCursor: true },
    )
    if (result.status !== 'ready') throw new Error('Expected a ready subscription.')
    hub.publish({
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

    expect(sent).toEqual([{ kind: 'event', event: visible }])
    expect(eventIsDenied).toHaveBeenCalledTimes(1)
    expect(eventIsDenied).toHaveBeenCalledWith(visible)
  })

  it('drains asynchronously denied events without exposing their cursors', async () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-test' })
    const result = hub.subscribeAfter()
    if (result.status !== 'ready') throw new Error('Expected a ready subscription.')
    hub.publish({
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

    expect(sent).toEqual([{ kind: 'event', event: visible }])
  })

  it('resumes from the last visible event across a filtered replay tail', async () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-test' })
    const acceptsVisibleSession = (event: {
      readonly payload: { readonly kind: string; readonly sessionId?: string }
    }) => event.payload.sessionId === 'visible-session'
    const firstResult = hub.subscribeAfter(hub.cursor(), acceptsVisibleSession)
    if (firstResult.status !== 'ready') throw new Error('Expected a ready subscription.')
    hub.publish({
      kind: 'session-state-changed',
      sessionId: 'private-session',
      stateRevision: 1,
      operation: 'run-settled',
    })
    const firstVisible = hub.publish({
      kind: 'session-state-changed',
      sessionId: 'visible-session',
      stateRevision: 1,
      operation: 'run-settled',
    })
    await expect(firstResult.subscription.next()).resolves.toEqual({
      status: 'event',
      event: firstVisible,
    })
    firstResult.subscription.close()

    hub.publish({
      kind: 'session-state-changed',
      sessionId: 'private-session',
      stateRevision: 2,
      operation: 'run-settled',
    })
    const resumed = hub.subscribeAfter(firstVisible.cursor, acceptsVisibleSession)
    if (resumed.status !== 'ready') throw new Error('Expected a resumed subscription.')
    const nextVisible = hub.publish({
      kind: 'session-state-changed',
      sessionId: 'visible-session',
      stateRevision: 2,
      operation: 'run-settled',
    })

    await expect(resumed.subscription.next()).resolves.toEqual({
      status: 'event',
      event: nextVisible,
    })
  })
})
