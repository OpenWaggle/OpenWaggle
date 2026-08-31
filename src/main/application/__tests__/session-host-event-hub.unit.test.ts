import { describe, expect, it } from 'vitest'
import { SessionHostEventHub } from '../session-host-event-hub'

describe('Session Host event hub', () => {
  it('closes the snapshot-to-subscription race with ordered replay followed by live events', async () => {
    const hub = new SessionHostEventHub({
      hostInstanceId: 'host-current',
      replayCapacity: 3,
      subscriberCapacity: 3,
      now: () => 1000,
    })
    const snapshotCursor = hub.cursor()
    hub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-target',
      stateRevision: 2,
      operation: 'message',
    })
    const result = hub.subscribeAfter(snapshotCursor)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    hub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-target',
      stateRevision: 3,
      operation: 'follow-up',
    })

    await expect(result.subscription.next()).resolves.toMatchObject({
      status: 'event',
      event: {
        cursor: { hostInstanceId: 'host-current', sequence: 1 },
        payload: { kind: 'session-state-changed', stateRevision: 2 },
      },
    })
    await expect(result.subscription.next()).resolves.toMatchObject({
      status: 'event',
      event: {
        cursor: { hostInstanceId: 'host-current', sequence: 2 },
        payload: { kind: 'session-state-changed', stateRevision: 3 },
      },
    })
  })

  it('requires canonical resynchronization for restarted and expired cursors', () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-current', replayCapacity: 2 })
    for (const stateRevision of [1, 2, 3]) {
      hub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-target',
        stateRevision,
        operation: 'message',
      })
    }

    expect(hub.subscribeAfter({ hostInstanceId: 'host-old', sequence: 3 })).toMatchObject({
      status: 'resync-required',
      reason: 'host-restarted',
    })
    expect(hub.subscribeAfter({ hostInstanceId: 'host-current', sequence: 0 })).toMatchObject({
      status: 'resync-required',
      reason: 'cursor-expired',
    })
    expect(
      hub.subscribeAfter({ hostInstanceId: 'host-current', sequence: 0 }, () => false, {
        advanceFilteredCursor: true,
      }),
    ).toMatchObject({ status: 'resync-required', reason: 'cursor-expired' })
  })

  it('disconnects a slow subscriber with structured resynchronization without blocking publish', async () => {
    const hub = new SessionHostEventHub({
      hostInstanceId: 'host-current',
      subscriberCapacity: 2,
    })
    const result = hub.subscribeAfter()
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    for (const stateRevision of [1, 2, 3]) {
      hub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-target',
        stateRevision,
        operation: 'message',
      })
    }

    expect(hub.subscriberCount()).toBe(0)
    await expect(result.subscription.next()).resolves.toMatchObject({
      status: 'resync-required',
      reason: 'slow-consumer',
      cursor: { hostInstanceId: 'host-current', sequence: 3 },
    })
  })

  it('resolves a pending read when the Host closes', async () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const result = hub.subscribeAfter()
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const pending = result.subscription.next()

    hub.close()

    await expect(pending).resolves.toEqual({ status: 'closed' })
    expect(hub.subscriberCount()).toBe(0)
  })

  it('evicts replay by retained bytes even when the event count is small', () => {
    const hub = new SessionHostEventHub({
      hostInstanceId: 'host-current',
      replayCapacity: 10,
      replayByteCapacity: 420,
    })
    const cursor = hub.cursor()
    for (const stateRevision of [1, 2, 3]) {
      hub.publish({
        kind: 'session-state-changed',
        sessionId: `session-${'x'.repeat(90)}`,
        stateRevision,
        operation: 'message',
      })
    }

    expect(hub.replayAfter(cursor)).toMatchObject({
      status: 'resync-required',
      reason: 'cursor-expired',
    })
  })

  it('disconnects a subscriber before retaining an oversized event', async () => {
    const hub = new SessionHostEventHub({
      hostInstanceId: 'host-current',
      subscriberCapacity: 10,
      subscriberByteCapacity: 256,
    })
    const result = hub.subscribeAfter()
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    hub.publish({
      kind: 'session-state-changed',
      sessionId: `session-${'x'.repeat(512)}`,
      stateRevision: 1,
      operation: 'message',
    })

    expect(hub.subscriberCount()).toBe(0)
    await expect(result.subscription.next()).resolves.toMatchObject({
      status: 'resync-required',
      reason: 'slow-consumer',
    })
  })

  it('resolves a pending read when a live event requires resynchronization', async () => {
    const hub = new SessionHostEventHub({
      hostInstanceId: 'host-current',
      subscriberCapacity: 10,
      subscriberByteCapacity: 256,
    })
    const result = hub.subscribeAfter()
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const pending = result.subscription.next()

    hub.publish({
      kind: 'session-state-changed',
      sessionId: `session-${'x'.repeat(512)}`,
      stateRevision: 1,
      operation: 'message',
    })

    await expect(pending).resolves.toMatchObject({
      status: 'resync-required',
      reason: 'slow-consumer',
    })
    expect(hub.subscriberCount()).toBe(0)
  })

  it('does not charge filtered events against a restricted subscriber', async () => {
    const hub = new SessionHostEventHub({
      hostInstanceId: 'host-current',
      subscriberCapacity: 2,
    })
    const result = hub.subscribeAfter(hub.cursor(), (event) =>
      event.payload.kind === 'semantic-discovery-readiness-changed'
        ? true
        : event.payload.sessionId === 'session-allowed',
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    for (let stateRevision = 1; stateRevision <= 20; stateRevision += 1) {
      hub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-denied',
        stateRevision,
        operation: 'message',
      })
    }
    hub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-allowed',
      stateRevision: 21,
      operation: 'message',
    })

    expect(hub.subscriberCount()).toBe(1)
    await expect(result.subscription.next()).resolves.toMatchObject({
      status: 'event',
      event: { payload: { sessionId: 'session-allowed' } },
    })
  })

  it('advances across filtered events without retaining their payloads', async () => {
    const hub = new SessionHostEventHub({
      hostInstanceId: 'host-current',
      subscriberCapacity: 1,
    })
    const result = hub.subscribeAfter(
      hub.cursor(),
      (event) =>
        event.payload.kind !== 'semantic-discovery-readiness-changed' &&
        event.payload.sessionId === 'session-allowed',
      { advanceFilteredCursor: true },
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    const firstDenied = hub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-denied',
      stateRevision: 1,
      operation: 'message',
    })
    const secondDenied = hub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-denied',
      stateRevision: 2,
      operation: 'message',
    })
    const visible = hub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-allowed',
      stateRevision: 3,
      operation: 'message',
    })
    const finalDenied = hub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-denied',
      stateRevision: 4,
      operation: 'message',
    })

    expect(firstDenied.cursor.sequence).toBe(1)
    expect(hub.subscriberCount()).toBe(1)
    await expect(result.subscription.next()).resolves.toEqual({
      status: 'cursor-advanced',
      cursor: secondDenied.cursor,
    })
    await expect(result.subscription.next()).resolves.toEqual({ status: 'event', event: visible })
    await expect(result.subscription.next()).resolves.toEqual({
      status: 'cursor-advanced',
      cursor: finalDenied.cursor,
    })
  })

  it('preserves filtered cursor advances around replayed visible events', async () => {
    const hub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const cursor = hub.cursor()
    const denied = hub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-denied',
      stateRevision: 1,
      operation: 'message',
    })
    const visible = hub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-allowed',
      stateRevision: 2,
      operation: 'message',
    })
    const result = hub.subscribeAfter(
      cursor,
      (event) =>
        event.payload.kind !== 'semantic-discovery-readiness-changed' &&
        event.payload.sessionId === 'session-allowed',
      { advanceFilteredCursor: true },
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    await expect(result.subscription.next()).resolves.toEqual({
      status: 'cursor-advanced',
      cursor: denied.cursor,
    })
    await expect(result.subscription.next()).resolves.toEqual({ status: 'event', event: visible })
  })

  it('bounds retained subscriber bytes across all connections', async () => {
    const hub = new SessionHostEventHub({
      hostInstanceId: 'host-current',
      subscriberCapacity: 10,
      subscriberByteCapacity: 1_024,
      subscriberAggregateByteCapacity: 500,
    })
    const first = hub.subscribeAfter()
    const second = hub.subscribeAfter()
    expect(first.status).toBe('ready')
    expect(second.status).toBe('ready')
    if (first.status !== 'ready' || second.status !== 'ready') return

    hub.publish({
      kind: 'session-state-changed',
      sessionId: `session-${'x'.repeat(190)}`,
      stateRevision: 1,
      operation: 'message',
    })

    expect(hub.subscriberCount()).toBe(1)
    await expect(second.subscription.next()).resolves.toMatchObject({
      status: 'resync-required',
      reason: 'slow-consumer',
    })
    first.subscription.close()
  })
})
