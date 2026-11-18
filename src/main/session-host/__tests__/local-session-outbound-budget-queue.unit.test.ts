import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  advance,
  budgetWith,
  CAPACITY_WAIT_MS,
  connection,
  evictableOwner,
  RESERVATION,
  settledState,
  UNREAD_FRAME,
  UNREAD_FRAME_BYTES,
  useFakeClock,
} from './local-session-outbound-budget.test-support'

describe('LocalSessionOutboundByteBudget queues and bounded frames', () => {
  afterEach(() => {
    vi.useRealTimers()
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
