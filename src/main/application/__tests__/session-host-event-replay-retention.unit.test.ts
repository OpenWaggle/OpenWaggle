import { describe, expect, it } from 'vitest'
import { SessionHostEventHub } from '../session-host-event-hub'

describe('Session Host event replay retention', () => {
  it('serializes each replay event once across retention, eviction, and replay', () => {
    const hub = new SessionHostEventHub({
      hostInstanceId: 'host-current',
      replayCapacity: 2,
    })
    let serializations = 0
    const payload = {
      kind: 'session-state-changed',
      sessionId: 'session-target',
      stateRevision: 1,
      operation: 'message',
      toJSON: () => {
        serializations += 1
        return {
          kind: 'session-state-changed',
          sessionId: 'session-target',
          stateRevision: 1,
          operation: 'message',
        }
      },
    } satisfies Parameters<SessionHostEventHub['publish']>[0] & {
      readonly toJSON: () => unknown
    }

    for (let index = 0; index < 5; index += 1) hub.publish(payload)
    hub.replayAfter({ hostInstanceId: 'host-current', sequence: 3 })
    hub.subscribeAfter({ hostInstanceId: 'host-current', sequence: 3 })

    expect(serializations).toBe(5)
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
