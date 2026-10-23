import { describe, expect, it } from 'vitest'
import {
  LocalSessionOutboundByteBudget,
  LocalSessionOutboundCapacityError,
} from '../local-session-outbound-budget'
import {
  connection,
  evictableOwner,
  RESERVATION,
  SMALL_FRAME,
  settledState,
  UNREAD_FRAME,
  UNREAD_FRAME_BYTES,
} from './local-session-outbound-budget.test-support'

/**
 * Real timers: a blocked event loop delays them exactly as it does in the Host, with ticks missed
 * and late timers firing together, which fake timers do not reproduce. Each test leaves the reader
 * hundreds of milliseconds of live time short of the wait, so a loaded machine does not flip it.
 */
const WAIT_MS = 1_000

/** One unread frame fills it. */
function realTimeBudget(
  options: { readonly capacityWaitMs?: number; readonly maxWaitMs?: number } = {},
) {
  return new LocalSessionOutboundByteBudget(RESERVATION + UNREAD_FRAME_BYTES - 1, {
    capacityWaitMs: options.capacityWaitMs ?? WAIT_MS,
    evictionReleaseWaitMs: 20,
    ...(options.maxWaitMs === undefined ? {} : { maxWaitMs: options.maxWaitMs }),
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

describe('LocalSessionOutboundByteBudget under Host stalls', () => {
  it('does not count a Host stall inside the wait against a reader', async () => {
    const budget = realTimeBudget()
    const reader = evictableOwner()
    const held = reader.hold(await budget.encode(UNREAD_FRAME, connection(), reader))
    const waiting = budget.encode({ ok: true }, connection())
    // Blocked from 50 to 900 ms of the 1 s wait; the reader catches up 100 ms after.
    await sleep(50)
    blockEventLoop(850)
    await sleep(100)
    expect(reader.evictions).toBe(0)
    held.release()
    await expect(waiting).resolves.toBeDefined()
    expect(reader.evictions).toBe(0)
  })

  it('does not blame a reader when a release wakes the wait first after a stall past the deadline', async () => {
    const budget = realTimeBudget()
    const reader = evictableOwner()
    const held = reader.hold(await budget.encode(UNREAD_FRAME, connection(), reader))
    const other = evictableOwner()
    // Bounded, so it is written although the budget is full; the budget stays full without it.
    const unrelated = other.hold(
      await budget.encode(SMALL_FRAME, connection(), other, { maxBytes: 1024 }),
    )
    const waiting = budget.encode({ ok: true }, connection())
    await sleep(100)
    blockEventLoop(1_500)
    // A write completion runs before the late timers when the loop resumes.
    unrelated.release()
    await sleep(100)
    expect(reader.evictions).toBe(0)
    held.release()
    await expect(waiting).resolves.toBeDefined()
    expect(reader.evictions).toBe(0)
  })

  it('still decides within the wall limit when the Host keeps stalling', async () => {
    const budget = realTimeBudget({ capacityWaitMs: 600, maxWaitMs: 1_300 })
    const reader = evictableOwner({ releasesOnEvict: false })
    reader.hold(await budget.encode(UNREAD_FRAME, connection(), reader))
    const startedAt = performance.now()
    const waiting = budget.encode({ ok: true }, connection())
    const state = settledState(waiting)
    while (!state.settled && performance.now() - startedAt < 5_000) {
      // Only 10 ms of every 410 serve sockets.
      blockEventLoop(400)
      await sleep(10)
    }
    await expect(waiting).rejects.toBeInstanceOf(LocalSessionOutboundCapacityError)
    // The reader got well under the 600 ms wait of live time: it is not blamed.
    expect(reader.evictions).toBe(0)
    expect(performance.now() - startedAt).toBeLessThan(2_500)
  })
})
