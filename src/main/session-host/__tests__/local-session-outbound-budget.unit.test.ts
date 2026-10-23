import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_SESSION_DEFAULT_CLIENT_TIMEOUT_MS } from '../local-session-client-connection'
import {
  DEFAULT_OUTBOUND_CAPACITY_WAIT_MS,
  DEFAULT_OUTBOUND_EVICTION_RELEASE_WAIT_MS,
  LocalSessionOutboundByteBudget,
  LocalSessionOutboundCapacityError,
  MAX_OUTBOUND_CAPACITY_WAIT_MS,
} from '../local-session-outbound-budget'
import {
  advance,
  budgetWith,
  CAPACITY,
  CAPACITY_WAIT_MS,
  connection,
  EVICTION_RELEASE_WAIT_MS,
  evictableOwner,
  RESERVATION,
  SMALL_FRAME,
  settledState,
  UNREAD_FRAME,
  UNREAD_FRAME_BYTES,
  useFakeClock,
} from './local-session-outbound-budget.test-support'

describe('LocalSessionOutboundByteBudget', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a waiting frame within the client answer timeout once its answer is ready', () => {
    // The limit, then one last eviction's release wait.
    expect(MAX_OUTBOUND_CAPACITY_WAIT_MS + DEFAULT_OUTBOUND_EVICTION_RELEASE_WAIT_MS).toBeLessThan(
      LOCAL_SESSION_DEFAULT_CLIENT_TIMEOUT_MS,
    )
    expect(
      DEFAULT_OUTBOUND_CAPACITY_WAIT_MS + DEFAULT_OUTBOUND_EVICTION_RELEASE_WAIT_MS,
    ).toBeLessThan(MAX_OUTBOUND_CAPACITY_WAIT_MS)
  })

  it('rejects an invalid capacity wait', () => {
    expect(() => new LocalSessionOutboundByteBudget(CAPACITY, { capacityWaitMs: -1 })).toThrow(
      'outbound capacity wait',
    )
    expect(
      () => new LocalSessionOutboundByteBudget(CAPACITY, { evictionReleaseWaitMs: 1.5 }),
    ).toThrow('outbound eviction release wait')
  })

  it('encodes a frame once an unread frame releases the room it held', async () => {
    useFakeClock()
    const budget = budgetWith()
    const held = await budget.encode(UNREAD_FRAME, connection())
    const second = await budget.encode(UNREAD_FRAME, connection())
    const waiting = budget.encode({ ok: true }, connection())
    const state = settledState(waiting)
    await advance(CAPACITY_WAIT_MS / 2)
    expect(state.settled).toBe(false)

    held.release()
    const lease = await waiting
    expect(JSON.parse(lease.payload.toString('utf8'))).toEqual({ ok: true })
    expect(lease.waitedMs).toBeGreaterThanOrEqual(CAPACITY_WAIT_MS / 2)
    lease.release()
    second.release()
    expect(budget.pendingBytes).toBe(0)
    expect(budget.peakBytes).toBeLessThanOrEqual(budget.maxBytes)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes the connection that left its frame unread for the whole wait, not the waiting one', async () => {
    useFakeClock()
    const budget = budgetWith()
    const stalled = evictableOwner()
    stalled.hold(await budget.encode(UNREAD_FRAME, connection(), stalled))
    stalled.hold(await budget.encode(UNREAD_FRAME, connection(), stalled))
    const waiter = evictableOwner()
    const waiting = budget.encode({ ok: true }, connection(), waiter)
    const state = settledState(waiting)

    await advance(CAPACITY_WAIT_MS - 20)
    expect(state.settled).toBe(false)
    expect(stalled.evictions).toBe(0)

    await advance(40)
    const lease = await waiting
    expect(stalled.evictions).toBe(1)
    expect(waiter.evictions).toBe(0)
    lease.release()
    expect(budget.pendingBytes).toBe(0)
  })

  it('keeps a connection that is still reading a large frame', async () => {
    useFakeClock()
    // A connection writes one frame at a time, so it holds at most one lease; this one fills the room.
    const budget = budgetWith({ capacity: RESERVATION + UNREAD_FRAME_BYTES - 1 })
    const reader = evictableOwner()
    const reading = reader.hold(await budget.encode(UNREAD_FRAME, connection(), reader))
    const waiting = budget.encode({ ok: true }, connection())
    for (let elapsed = 0; elapsed < CAPACITY_WAIT_MS * 2; elapsed += CAPACITY_WAIT_MS / 4) {
      await advance(CAPACITY_WAIT_MS / 4)
      // A segment of the frame was written.
      reading.touch()
    }
    expect(reader.evictions).toBe(0)
    reading.release()
    await expect(waiting).resolves.toBeDefined()
  })

  it('closes the stalled connection that frees enough room alone, not one that cannot', async () => {
    useFakeClock()
    // The small reader's 75 bytes do not close the gap; the large reader's do.
    const budget = budgetWith({ capacity: RESERVATION + 8000 })
    const small = evictableOwner()
    small.hold(await budget.encode(SMALL_FRAME, connection(), small))
    const large = evictableOwner()
    large.hold(await budget.encode({ text: 'x'.repeat(8000) }, connection(), large))

    const waiting = budget.encode({ ok: true }, connection())
    await advance(CAPACITY_WAIT_MS + 20)
    await expect(waiting).resolves.toBeDefined()
    expect(large.evictions).toBe(1)
    expect(small.evictions).toBe(0)
  })

  it('waits for the evicted connection itself before closing another one', async () => {
    useFakeClock()
    const budget = budgetWith({ capacity: RESERVATION + 2 * UNREAD_FRAME_BYTES })
    const slowToClose = evictableOwner({ releasesOnEvict: false })
    const heldBySlow = await budget.encode(UNREAD_FRAME, connection(), slowToClose)
    const other = evictableOwner()
    const heldByOther = other.hold(await budget.encode(SMALL_FRAME, connection(), other))
    const bystander = evictableOwner()
    bystander.hold(await budget.encode(UNREAD_FRAME, connection(), bystander))

    const waiting = budget.encode(UNREAD_FRAME, connection())
    await advance(CAPACITY_WAIT_MS + 20)
    expect(slowToClose.evictions).toBe(1)
    // A small, unrelated release does not count as the evicted connection going away.
    heldByOther.release()
    await advance(EVICTION_RELEASE_WAIT_MS / 2)
    expect(bystander.evictions).toBe(0)
    heldBySlow.release()
    await expect(waiting).resolves.toBeDefined()
    expect(bystander.evictions).toBe(0)
  })

  it('closes the reader that has stopped the longest when several free enough room alone', async () => {
    useFakeClock()
    // 50 bytes are missing; either reader's frame frees that much.
    const budget = budgetWith({ capacity: RESERVATION + UNREAD_FRAME_BYTES + 75 - 50 })
    const older = evictableOwner()
    older.hold(await budget.encode(SMALL_FRAME, connection(), older))
    await advance(100)
    const larger = evictableOwner()
    larger.hold(await budget.encode(UNREAD_FRAME, connection(), larger))

    const waiting = budget.encode({ ok: true }, connection())
    await advance(CAPACITY_WAIT_MS + 20)
    await expect(waiting).resolves.toBeDefined()
    expect(older.evictions).toBe(1)
    expect(larger.evictions).toBe(0)
  })

  it('closes a reader as soon as it reaches the stop time after the wait', async () => {
    useFakeClock()
    const budget = budgetWith({ capacity: RESERVATION + UNREAD_FRAME_BYTES - 1 })
    const reader = evictableOwner()
    const reading = reader.hold(await budget.encode(UNREAD_FRAME, connection(), reader))
    const waiting = budget.encode({ ok: true }, connection())
    await advance(CAPACITY_WAIT_MS / 2)
    // It read a slice at 500 ms, then stopped: it reaches the stop time at 1.5 s.
    reading.touch()
    await advance(CAPACITY_WAIT_MS - 100)
    expect(reader.evictions).toBe(0)
    await advance(150)
    expect(reader.evictions).toBe(1)
    await expect(waiting).resolves.toBeDefined()
  })

  it('closes as many stopped readers as it takes at the wall limit', async () => {
    useFakeClock()
    // 200 bytes are missing. The frame's wall limit passes before its own capacity wait.
    const budget = budgetWith({
      capacity: RESERVATION + 2 * UNREAD_FRAME_BYTES - 200,
      capacityWaitMs: 2 * CAPACITY_WAIT_MS,
      maxWaitMs: CAPACITY_WAIT_MS / 2,
    })
    const stuck = evictableOwner({ releasesOnEvict: false })
    stuck.hold(await budget.encode(UNREAD_FRAME, connection(), stuck))
    const closes = evictableOwner()
    closes.hold(await budget.encode(UNREAD_FRAME, connection(), closes))
    await advance(5 * CAPACITY_WAIT_MS)

    const waiting = budget.encode({ ok: true }, connection())
    await advance(CAPACITY_WAIT_MS / 2 + EVICTION_RELEASE_WAIT_MS + 40)
    await expect(waiting).resolves.toBeDefined()
    expect(stuck.evictions).toBe(1)
    expect(closes.evictions).toBe(1)
  })

  it('evicts a connection once, then moves on to the next', async () => {
    useFakeClock()
    const budget = budgetWith({ capacity: RESERVATION + 2 * UNREAD_FRAME_BYTES })
    const stuck = evictableOwner({ releasesOnEvict: false })
    await budget.encode(UNREAD_FRAME, connection(), stuck)
    await budget.encode(UNREAD_FRAME, connection(), stuck)
    const next = evictableOwner()
    next.hold(await budget.encode(UNREAD_FRAME, connection(), next))

    const waiting = budget.encode({ ok: true }, connection())
    await advance(CAPACITY_WAIT_MS + EVICTION_RELEASE_WAIT_MS + 40)
    expect(stuck.evictions).toBe(1)
    expect(next.evictions).toBe(1)
    await expect(waiting).resolves.toBeDefined()
  })

  it('fails at the wall limit when only frames of no connection hold the room', async () => {
    useFakeClock()
    const budget = budgetWith({ capacityWaitMs: 0, maxWaitMs: 300 })
    const held = await budget.encode(UNREAD_FRAME, connection())
    const second = await budget.encode(UNREAD_FRAME, connection())
    const waiting = budget.encode({ ok: true }, connection())
    const state = settledState(waiting)
    const failed = expect(waiting).rejects.toBeInstanceOf(LocalSessionOutboundCapacityError)
    await advance(250)
    expect(state.settled).toBe(false)
    await advance(100)
    await failed
    held.release()
    second.release()
    expect(budget.pendingBytes).toBe(0)
  })

  it('closes a stopped reader once more before failing on the wall limit', async () => {
    useFakeClock()
    const budget = budgetWith({ maxWaitMs: CAPACITY_WAIT_MS / 2 })
    const stalled = evictableOwner()
    stalled.hold(await budget.encode(UNREAD_FRAME, connection(), stalled))
    stalled.hold(await budget.encode(UNREAD_FRAME, connection(), stalled))
    // The reader stopped long ago; this frame's limit passes before its own capacity wait.
    await advance(CAPACITY_WAIT_MS * 2)
    const waiting = budget.encode({ ok: true }, connection())
    await advance(CAPACITY_WAIT_MS / 2 + 20)
    await expect(waiting).resolves.toBeDefined()
    expect(stalled.evictions).toBe(1)
  })

  it('does not close a stopped reader whose frames could not make room, and does not spin', async () => {
    useFakeClock()
    const timeouts = vi.spyOn(globalThis, 'setTimeout')
    // 76 bytes are missing; the stopped reader holds 75, the rest belongs to no connection.
    const budget = budgetWith({ capacity: RESERVATION + UNREAD_FRAME_BYTES - 1, maxWaitMs: 3_000 })
    const held = await budget.encode(UNREAD_FRAME, connection())
    const small = evictableOwner()
    small.hold(await budget.encode(SMALL_FRAME, connection(), small, { maxBytes: 1024 }))
    const waiting = budget.encode({ ok: true }, connection())
    await advance(CAPACITY_WAIT_MS * 2)
    expect(small.evictions).toBe(0)
    // One wait for the capacity wait, one for a release: not a poll.
    expect(timeouts.mock.calls.length).toBeLessThan(5)
    held.release()
    await expect(waiting).resolves.toBeDefined()
    expect(small.evictions).toBe(0)
  })

  it('stops waiting when its connection goes away and leaves no timer behind', async () => {
    useFakeClock()
    const budget = budgetWith()
    const held = await budget.encode(UNREAD_FRAME, connection())
    const second = await budget.encode(UNREAD_FRAME, connection())
    const closing = new AbortController()
    const waiting = budget.encode({ ok: true }, closing.signal)
    await advance(10)
    closing.abort()
    await expect(waiting).rejects.toThrow('Local Session outbound encoding was aborted.')
    held.release()
    second.release()
    expect(budget.pendingBytes).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('writes waiting frames in the order they asked for room', async () => {
    useFakeClock()
    const budget = budgetWith()
    const held = await budget.encode(UNREAD_FRAME, connection())
    const second = await budget.encode(UNREAD_FRAME, connection())
    const order: string[] = []
    const first = budget.encode({ name: 'first' }, connection()).then((lease) => {
      order.push('first')
      return lease
    })
    const later = budget.encode({ name: 'second' }, connection()).then((lease) => {
      order.push('second')
      return lease
    })
    await advance(10)
    held.release()
    second.release()
    ;(await first).release()
    ;(await later).release()
    expect(order).toEqual(['first', 'second'])
  })
})
