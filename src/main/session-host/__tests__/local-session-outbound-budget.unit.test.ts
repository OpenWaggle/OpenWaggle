import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_SESSION_DEFAULT_CLIENT_TIMEOUT_MS } from '../local-session-client-connection'
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

const RESERVATION = MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES + MAX_LOCAL_SESSION_FRAME_BYTES
/** Room for one encoding plus about 4 KiB retained, so one small unread frame fills it. */
const CAPACITY = RESERVATION + 4096
const UNREAD_FRAME = { text: 'x'.repeat(4096) }
const SMALL_FRAME = { text: 'x'.repeat(64) }
const CAPACITY_WAIT_MS = 1_000
const EVICTION_RELEASE_WAIT_MS = 100

function budgetWith(
  options: { readonly capacity?: number; readonly capacityWaitMs?: number } = {},
) {
  return new LocalSessionOutboundByteBudget(options.capacity ?? CAPACITY, {
    capacityWaitMs: options.capacityWaitMs ?? CAPACITY_WAIT_MS,
    evictionReleaseWaitMs: EVICTION_RELEASE_WAIT_MS,
    // Fake timers move Date, not performance.now().
    now: () => Date.now(),
  })
}

/** Fakes timeouts and Date; setImmediate stays real so the budget's I/O yield still runs. */
function useFakeClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
}

/** Moves the fake clock in small steps, letting real I/O turns run between them. */
async function advance(milliseconds: number) {
  const step = 10
  for (let elapsed = 0; elapsed < milliseconds; elapsed += step) {
    await vi.advanceTimersByTimeAsync(Math.min(step, milliseconds - elapsed))
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function connection() {
  return new AbortController().signal
}

type TestOwner = LocalSessionOutboundOwner & {
  evictions: number
  hold: (lease: LocalSessionOutboundLease) => LocalSessionOutboundLease
}

/** An owner whose eviction releases the frames it holds, as closing its socket does. */
function evictableOwner(options: { readonly releasesOnEvict?: boolean } = {}): TestOwner {
  const leases: LocalSessionOutboundLease[] = []
  const owner: TestOwner = {
    evictions: 0,
    evict: () => {
      owner.evictions += 1
      if (options.releasesOnEvict === false) return
      for (const lease of leases) lease.release()
    },
    hold: (lease) => {
      leases.push(lease)
      return lease
    },
  }
  return owner
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

  it('decides before the client gives up waiting for its answer', () => {
    expect(
      DEFAULT_OUTBOUND_CAPACITY_WAIT_MS + DEFAULT_OUTBOUND_EVICTION_RELEASE_WAIT_MS,
    ).toBeLessThan(LOCAL_SESSION_DEFAULT_CLIENT_TIMEOUT_MS)
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
    const waiting = budget.encode({ ok: true }, connection())
    const state = settledState(waiting)
    await advance(CAPACITY_WAIT_MS / 2)
    expect(state.settled).toBe(false)

    held.release()
    const lease = await waiting
    expect(JSON.parse(lease.payload.toString('utf8'))).toEqual({ ok: true })
    expect(lease.waitedMs).toBe(CAPACITY_WAIT_MS / 2)
    lease.release()
    expect(budget.pendingBytes).toBe(0)
    expect(budget.peakBytes).toBeLessThanOrEqual(budget.maxBytes)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes the connection that left its frame unread for the whole wait, not the waiting one', async () => {
    useFakeClock()
    const budget = budgetWith()
    const stalled = evictableOwner()
    stalled.hold(await budget.encode(UNREAD_FRAME, connection(), stalled))
    const waiter = evictableOwner()
    const waiting = budget.encode({ ok: true }, connection(), waiter)
    const state = settledState(waiting)

    await advance(CAPACITY_WAIT_MS - 1)
    expect(state.settled).toBe(false)
    expect(stalled.evictions).toBe(0)

    await advance(1)
    const lease = await waiting
    expect(stalled.evictions).toBe(1)
    expect(waiter.evictions).toBe(0)
    lease.release()
    expect(budget.pendingBytes).toBe(0)
  })

  it('does not blame a client for a Host stall that ran past the deadline', async () => {
    useFakeClock()
    const budget = budgetWith()
    const reader = evictableOwner()
    const held = reader.hold(await budget.encode(UNREAD_FRAME, connection(), reader))
    const waiting = budget.encode({ ok: true }, connection())

    await advance(CAPACITY_WAIT_MS / 2)
    // The Host blocks past the deadline, so the wait wakes late; the client could not be read from.
    vi.setSystemTime(Date.now() + CAPACITY_WAIT_MS)
    await advance(CAPACITY_WAIT_MS / 2)
    expect(reader.evictions).toBe(0)

    // Once the Host runs again the client reads its frame within the extended wait.
    held.release()
    await expect(waiting).resolves.toBeDefined()
    expect(reader.evictions).toBe(0)
  })

  it('decides each queued frame within the wait of its own arrival', async () => {
    useFakeClock()
    // Full: each eviction frees room for one queued frame, which fills the budget again.
    const budget = budgetWith({ capacity: RESERVATION + 12_300 })
    const owners = [evictableOwner(), evictableOwner(), evictableOwner()]
    for (const owner of owners) owner.hold(await budget.encode(UNREAD_FRAME, connection(), owner))
    const decidedAt: number[] = []
    const queued = [1, 2, 3].map((index) =>
      budget.encode({ text: 'x'.repeat(4096), index }, connection()).then((lease) => {
        decidedAt.push(Date.now())
        return lease
      }),
    )
    const startedAt = Date.now()
    await advance(CAPACITY_WAIT_MS + EVICTION_RELEASE_WAIT_MS)
    await Promise.all(queued)
    for (const time of decidedAt) {
      expect(time - startedAt).toBeLessThanOrEqual(CAPACITY_WAIT_MS + EVICTION_RELEASE_WAIT_MS)
    }
  })

  it('closes the stalled connection that frees enough room alone before older small ones', async () => {
    useFakeClock()
    // 75 bytes held by the small reader do not close the 86 missing; the large reader's do.
    const budget = budgetWith({ capacity: RESERVATION + 8000 })
    const small = evictableOwner()
    small.hold(await budget.encode(SMALL_FRAME, connection(), small))
    const large = evictableOwner()
    large.hold(await budget.encode({ text: 'x'.repeat(8000) }, connection(), large))

    const waiting = budget.encode({ ok: true }, connection())
    await advance(CAPACITY_WAIT_MS)
    await expect(waiting).resolves.toBeDefined()
    expect(large.evictions).toBe(1)
    expect(small.evictions).toBe(0)
  })

  it('waits for the evicted connection itself before closing another one', async () => {
    useFakeClock()
    const budget = budgetWith({ capacity: RESERVATION + 8200 })
    const slowToClose = evictableOwner({ releasesOnEvict: false })
    const heldBySlow = await budget.encode(UNREAD_FRAME, connection(), slowToClose)
    const other = evictableOwner()
    const heldByOther = other.hold(await budget.encode(SMALL_FRAME, connection(), other))
    const bystander = evictableOwner()
    bystander.hold(await budget.encode(UNREAD_FRAME, connection(), bystander))

    const waiting = budget.encode(UNREAD_FRAME, connection())
    await advance(CAPACITY_WAIT_MS)
    expect(slowToClose.evictions + bystander.evictions).toBe(1)
    const evictedFirst = slowToClose.evictions === 1 ? heldBySlow : undefined
    // A small, unrelated release must not count as the evicted connection going away.
    heldByOther.release()
    await advance(EVICTION_RELEASE_WAIT_MS / 2)
    expect(slowToClose.evictions + bystander.evictions).toBe(1)
    evictedFirst?.release()
    await advance(EVICTION_RELEASE_WAIT_MS)
    await expect(waiting).resolves.toBeDefined()
  })

  it('evicts a connection once, then moves on to the next', async () => {
    useFakeClock()
    const budget = budgetWith({ capacity: RESERVATION + 3 * 4096 })
    const stuck = evictableOwner({ releasesOnEvict: false })
    await budget.encode(UNREAD_FRAME, connection(), stuck)
    await budget.encode(UNREAD_FRAME, connection(), stuck)
    const next = evictableOwner()
    next.hold(await budget.encode(UNREAD_FRAME, connection(), next))

    const waiting = budget.encode({ ok: true }, connection())
    await advance(CAPACITY_WAIT_MS + EVICTION_RELEASE_WAIT_MS)
    expect(stuck.evictions).toBe(1)
    expect(next.evictions).toBe(1)
    await expect(waiting).resolves.toBeDefined()
  })

  it('fails with a capacity error when only frames newer than its arrival hold the room', async () => {
    useFakeClock()
    const budget = budgetWith({ capacityWaitMs: 0 })
    const held = await budget.encode(UNREAD_FRAME, connection())
    await expect(budget.encode({ ok: true }, connection())).rejects.toBeInstanceOf(
      LocalSessionOutboundCapacityError,
    )
    held.release()
    expect(budget.pendingBytes).toBe(0)
  })

  it('stops waiting when its connection goes away and leaves no timer behind', async () => {
    useFakeClock()
    const budget = budgetWith()
    const held = await budget.encode(UNREAD_FRAME, connection())
    const closing = new AbortController()
    const waiting = budget.encode({ ok: true }, closing.signal)
    await advance(10)
    closing.abort()
    await expect(waiting).rejects.toThrow('Local Session outbound encoding was aborted.')
    expect(vi.getTimerCount()).toBe(0)
    held.release()
    expect(budget.pendingBytes).toBe(0)
  })

  it('writes waiting frames in the order they asked for room', async () => {
    useFakeClock()
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
    await advance(10)
    held.release()
    ;(await first).release()
    ;(await second).release()
    expect(order).toEqual(['first', 'second'])
  })
})
