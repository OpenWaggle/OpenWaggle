import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LocalSessionOutboundByteBudget,
  LocalSessionOutboundCapacityError,
} from '../local-session-outbound-budget'
import {
  advance,
  budgetWith,
  CAPACITY_WAIT_MS,
  connection,
  evictableOwner,
  RESERVATION,
  SMALL_FRAME,
  settledState,
  UNREAD_FRAME,
  UNREAD_FRAME_BYTES,
  useFakeClock,
} from './local-session-outbound-budget.test-support'

const REAL_TIME_WAIT_MS = 300

/** One unread frame fills it. */
function realTimeBudget(capacity = RESERVATION + UNREAD_FRAME_BYTES - 1) {
  return new LocalSessionOutboundByteBudget(capacity, {
    capacityWaitMs: REAL_TIME_WAIT_MS,
    evictionReleaseWaitMs: 20,
  })
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** A synchronous Host stall. */
function blockEventLoop(milliseconds: number) {
  const blockedUntil = performance.now() + milliseconds
  while (performance.now() < blockedUntil) {
    // Blocked: no timer, socket or promise runs.
  }
}

describe('LocalSessionOutboundByteBudget under Host stalls and queues', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // Real timers below: a blocked event loop delays them exactly as it does in the Host.

  it('does not count a Host stall inside the wait against a reader', async () => {
    const budget = realTimeBudget()
    const reader = evictableOwner()
    const held = reader.hold(await budget.encode(UNREAD_FRAME, connection(), reader))
    const waiting = budget.encode({ ok: true }, connection())
    // Blocked from 30 to 280 ms of the 300 ms wait; the reader catches up 50 ms after.
    await sleep(30)
    blockEventLoop(250)
    await sleep(50)
    expect(reader.evictions).toBe(0)
    held.release()
    await expect(waiting).resolves.toBeDefined()
    expect(reader.evictions).toBe(0)
  })

  it('does not blame a reader when a release wakes the wait first after a stall past the deadline', async () => {
    // Still full once the small frame is released.
    const budget = realTimeBudget()
    const reader = evictableOwner()
    const held = reader.hold(await budget.encode(UNREAD_FRAME, connection(), reader))
    const other = evictableOwner()
    // Bounded, so it is written although the budget is full.
    const unrelated = other.hold(
      await budget.encode(SMALL_FRAME, connection(), other, { maxBytes: 1024 }),
    )
    const waiting = budget.encode({ ok: true }, connection())
    await sleep(100)
    blockEventLoop(600)
    // A write completion runs before the late timers when the loop resumes.
    unrelated.release()
    await sleep(50)
    expect(reader.evictions).toBe(0)
    held.release()
    await expect(waiting).resolves.toBeDefined()
    expect(reader.evictions).toBe(0)
  })

  it('gives a queued frame its own wait when the frame ahead refills the budget', async () => {
    useFakeClock()
    // One unread frame fills it.
    const budget = budgetWith({ capacity: RESERVATION + UNREAD_FRAME_BYTES - 1 })
    const stalled = evictableOwner()
    stalled.hold(await budget.encode(UNREAD_FRAME, connection(), stalled))
    const ahead = evictableOwner()
    const first = budget.encode(UNREAD_FRAME, connection(), ahead)
    const second = settledState(budget.encode(UNREAD_FRAME, connection(), evictableOwner()))

    await advance(CAPACITY_WAIT_MS + 20)
    expect(stalled.evictions).toBe(1)
    const aheadLease = await first
    // The frame ahead holds the room again, but its reader is healthy: the queued one waits.
    await advance(50)
    expect(second.settled).toBe(false)
    expect(ahead.evictions).toBe(0)
    aheadLease.release()
    await advance(20)
    expect(second.settled).toBe(true)
    expect(second.failed).toBe(false)
  })

  it('still decides within the wall limit when the Host keeps stalling', async () => {
    // Real timers: a stalled event loop delays them, as it does in the Host.
    const budget = new LocalSessionOutboundByteBudget(RESERVATION + UNREAD_FRAME_BYTES - 1, {
      capacityWaitMs: 200,
      evictionReleaseWaitMs: 20,
      maxWaitMs: 600,
    })
    const reader = evictableOwner({ releasesOnEvict: false })
    reader.hold(await budget.encode(UNREAD_FRAME, connection(), reader))
    const startedAt = performance.now()
    const waiting = budget.encode({ ok: true }, connection())
    const state = settledState(waiting)
    while (!state.settled && performance.now() - startedAt < 5_000) {
      // Only 10 ms of every 310 serve sockets.
      blockEventLoop(300)
      await sleep(10)
    }
    await expect(waiting).rejects.toBeInstanceOf(LocalSessionOutboundCapacityError)
    // The reader got about 100 ms of live time, short of the 200 ms wait: it is not blamed.
    expect(reader.evictions).toBe(0)
    expect(performance.now() - startedAt).toBeLessThan(1_500)
  })

  it('writes a bounded handshake frame at once while a large frame waits for room', async () => {
    useFakeClock()
    const budget = budgetWith()
    const held = await budget.encode(UNREAD_FRAME, connection())
    const second = await budget.encode(UNREAD_FRAME, connection())
    const waiting = settledState(budget.encode({ ok: true }, connection()))
    const handshake = await budget.encode({ accepted: true }, connection(), undefined, {
      maxBytes: 1024,
    })
    expect(waiting.settled).toBe(false)
    handshake.release()
    held.release()
    second.release()
    await advance(10)
    expect(waiting.settled).toBe(true)
  })

  it('makes a frame larger than its bound wait like any frame', async () => {
    useFakeClock()
    const budget = budgetWith()
    const held = await budget.encode(UNREAD_FRAME, connection())
    const second = await budget.encode(UNREAD_FRAME, connection())
    const oversized = settledState(
      budget.encode(UNREAD_FRAME, connection(), undefined, { maxBytes: 1024 }),
    )
    await advance(10)
    expect(oversized.settled).toBe(false)
    expect(budget.peakBytes).toBeLessThanOrEqual(budget.maxBytes)
    held.release()
    second.release()
    await advance(10)
    expect(oversized.settled).toBe(true)
  })
})
