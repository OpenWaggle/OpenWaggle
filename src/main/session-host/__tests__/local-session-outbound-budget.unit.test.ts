import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_SESSION_DEFAULT_CLIENT_TIMEOUT_MS } from '../local-session-client-connection'
import { DEFAULT_HANDSHAKE_TIMEOUT_MS } from '../local-session-connection'
import {
  MAX_LOCAL_SESSION_FRAME_BYTES,
  MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES,
} from '../local-session-framing'
import {
  DEFAULT_OUTBOUND_CAPACITY_WAIT_MS,
  DEFAULT_OUTBOUND_EVICTION_RELEASE_WAIT_MS,
  LocalSessionOutboundByteBudget,
  LocalSessionOutboundCapacityError,
  type LocalSessionOutboundLease,
  type LocalSessionOutboundOwner,
} from '../local-session-outbound-budget'

/** Room for one encoding plus a few hundred retained bytes, so one small unread frame fills it. */
const CAPACITY = MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES + MAX_LOCAL_SESSION_FRAME_BYTES + 256
const UNREAD_FRAME = { text: 'x'.repeat(512) }
const CAPACITY_WAIT_MS = 1_000
const EVICTION_RELEASE_WAIT_MS = 100

function budgetWith(options: { readonly capacityWaitMs?: number } = {}) {
  return new LocalSessionOutboundByteBudget(CAPACITY, {
    capacityWaitMs: options.capacityWaitMs ?? CAPACITY_WAIT_MS,
    evictionReleaseWaitMs: EVICTION_RELEASE_WAIT_MS,
  })
}

function connection() {
  return new AbortController().signal
}

/** An owner whose eviction releases the frames it holds, as closing its socket does. */
function evictableOwner() {
  const leases: LocalSessionOutboundLease[] = []
  const owner: LocalSessionOutboundOwner & { evictions: number } = {
    evictions: 0,
    evict: () => {
      owner.evictions += 1
      for (const lease of leases) lease.release()
    },
  }
  return { owner, hold: (lease: LocalSessionOutboundLease) => leases.push(lease) }
}

function settledState(promise: Promise<unknown>) {
  const state = { settled: false }
  void promise.then(
    () => {
      state.settled = true
    },
    () => {
      state.settled = true
    },
  )
  return state
}

describe('LocalSessionOutboundByteBudget', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('decides before the client gives up on its handshake or response', () => {
    const decidedWithinMs =
      DEFAULT_OUTBOUND_CAPACITY_WAIT_MS + DEFAULT_OUTBOUND_EVICTION_RELEASE_WAIT_MS
    expect(decidedWithinMs).toBeLessThan(DEFAULT_HANDSHAKE_TIMEOUT_MS)
    expect(decidedWithinMs).toBeLessThan(LOCAL_SESSION_DEFAULT_CLIENT_TIMEOUT_MS)
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
    vi.useFakeTimers()
    const budget = budgetWith()
    const held = await budget.encode(UNREAD_FRAME, connection())
    const waiting = budget.encode({ ok: true }, connection())
    const state = settledState(waiting)
    await vi.advanceTimersByTimeAsync(CAPACITY_WAIT_MS / 2)
    expect(state.settled).toBe(false)

    held.release()
    const lease = await waiting
    expect(JSON.parse(lease.payload.toString('utf8'))).toEqual({ ok: true })
    lease.release()
    expect(budget.pendingBytes).toBe(0)
    expect(budget.peakBytes).toBeLessThanOrEqual(budget.maxBytes)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes the connection that left its frame unread for the whole wait, not the waiting one', async () => {
    vi.useFakeTimers()
    const budget = budgetWith()
    const stalled = evictableOwner()
    stalled.hold(await budget.encode(UNREAD_FRAME, connection(), stalled.owner))
    const waiter = evictableOwner()
    const waiting = budget.encode({ ok: true }, connection(), waiter.owner)
    const state = settledState(waiting)

    await vi.advanceTimersByTimeAsync(CAPACITY_WAIT_MS - 1)
    expect(state.settled).toBe(false)
    expect(stalled.owner.evictions).toBe(0)

    await vi.advanceTimersByTimeAsync(1)
    const lease = await waiting
    expect(stalled.owner.evictions).toBe(1)
    expect(waiter.owner.evictions).toBe(0)
    lease.release()
    expect(budget.pendingBytes).toBe(0)
  })

  it('evicts a connection once, then moves on to the next oldest', async () => {
    vi.useFakeTimers()
    const budget = new LocalSessionOutboundByteBudget(CAPACITY + 1024, {
      capacityWaitMs: CAPACITY_WAIT_MS,
      evictionReleaseWaitMs: EVICTION_RELEASE_WAIT_MS,
    })
    const stuck: LocalSessionOutboundOwner & { evictions: number } = {
      evictions: 0,
      // Its socket never closes, so its frames stay retained.
      evict: () => {
        stuck.evictions += 1
      },
    }
    await budget.encode(UNREAD_FRAME, connection(), stuck)
    await budget.encode(UNREAD_FRAME, connection(), stuck)
    const next = evictableOwner()
    next.hold(await budget.encode(UNREAD_FRAME, connection(), next.owner))

    const waiting = budget.encode({ ok: true }, connection())
    await vi.advanceTimersByTimeAsync(CAPACITY_WAIT_MS + EVICTION_RELEASE_WAIT_MS)
    expect(stuck.evictions).toBe(1)
    expect(next.owner.evictions).toBe(1)
    await expect(waiting).resolves.toBeDefined()
  })

  it('fails with a capacity error when only frames newer than the wait hold the room', async () => {
    vi.useFakeTimers()
    const budget = budgetWith({ capacityWaitMs: 0 })
    const held = await budget.encode(UNREAD_FRAME, connection())
    await expect(budget.encode({ ok: true }, connection())).rejects.toBeInstanceOf(
      LocalSessionOutboundCapacityError,
    )
    held.release()
    expect(budget.pendingBytes).toBe(0)
  })

  it('stops waiting when its connection goes away and leaves no timer behind', async () => {
    vi.useFakeTimers()
    const budget = budgetWith()
    const held = await budget.encode(UNREAD_FRAME, connection())
    const closing = new AbortController()
    const waiting = budget.encode({ ok: true }, closing.signal)
    await vi.advanceTimersByTimeAsync(10)
    closing.abort()
    await expect(waiting).rejects.toThrow('Local Session outbound encoding was aborted.')
    expect(vi.getTimerCount()).toBe(0)
    held.release()
    expect(budget.pendingBytes).toBe(0)
  })

  it('writes waiting frames in the order they asked for room', async () => {
    vi.useFakeTimers()
    const budget = budgetWith()
    const held = await budget.encode(UNREAD_FRAME, connection())
    const order: string[] = []
    const first = budget.encode({ name: 'first' }, connection()).then((lease) => {
      order.push('first')
      return lease
    })
    const second = budget.encode({ name: 'second' }, connection()).then((lease) => {
      order.push('second')
      return lease
    })
    await vi.advanceTimersByTimeAsync(10)
    held.release()
    ;(await first).release()
    ;(await second).release()
    expect(order).toEqual(['first', 'second'])
  })

  it('wakes on a release that lands while the encode is still deciding to wait', async () => {
    vi.useFakeTimers()
    const budget = budgetWith()
    const held = await budget.encode(UNREAD_FRAME, connection())
    const waiting = budget.encode({ ok: true }, connection())
    // Released before any timer could fire: the waiting encode must not sleep until its deadline.
    queueMicrotask(() => held.release())
    await vi.advanceTimersByTimeAsync(0)
    await expect(waiting).resolves.toBeDefined()
  })
})
