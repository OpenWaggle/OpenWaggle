import { vi } from 'vitest'
import {
  MAX_LOCAL_SESSION_FRAME_BYTES,
  MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES,
} from '../local-session-framing'
import {
  LocalSessionOutboundByteBudget,
  type LocalSessionOutboundLease,
  type LocalSessionOutboundOwner,
} from '../local-session-outbound-budget'

export const RESERVATION = MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES + MAX_LOCAL_SESSION_FRAME_BYTES
/** `UNREAD_FRAME` encodes to 4107 bytes, `SMALL_FRAME` to 75. */
export const UNREAD_FRAME = { text: 'x'.repeat(4096) }
export const SMALL_FRAME = { text: 'x'.repeat(64) }
export const UNREAD_FRAME_BYTES = 4107
/** Room for one encoding plus one unread frame, so one more unread frame fills it. */
export const CAPACITY = RESERVATION + UNREAD_FRAME_BYTES + 100
export const CAPACITY_WAIT_MS = 1_000
export const EVICTION_RELEASE_WAIT_MS = 100

export function budgetWith(
  options: {
    readonly capacity?: number
    readonly capacityWaitMs?: number
    readonly maxWaitMs?: number
  } = {},
) {
  return new LocalSessionOutboundByteBudget(options.capacity ?? CAPACITY, {
    capacityWaitMs: options.capacityWaitMs ?? CAPACITY_WAIT_MS,
    evictionReleaseWaitMs: EVICTION_RELEASE_WAIT_MS,
    maxWaitMs: options.maxWaitMs,
    // Fake timers move Date, not performance.now().
    now: () => Date.now(),
  })
}

/** Fakes timers and Date; setImmediate stays real so the budget's I/O yield still runs. */
export function useFakeClock() {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
}

/** Moves the fake clock in small steps, letting real I/O turns run between them. */
export async function advance(milliseconds: number) {
  const step = 10
  for (let elapsed = 0; elapsed < milliseconds; elapsed += step) {
    await vi.advanceTimersByTimeAsync(Math.min(step, milliseconds - elapsed))
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  await new Promise<void>((resolve) => setImmediate(resolve))
}

export function connection() {
  return new AbortController().signal
}

export type TestOwner = LocalSessionOutboundOwner & {
  evictions: number
  hold: (lease: LocalSessionOutboundLease) => LocalSessionOutboundLease
}

/** An owner whose eviction releases the frames it holds, as closing its socket does. */
export function evictableOwner(options: { readonly releasesOnEvict?: boolean } = {}): TestOwner {
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

export function settledState(promise: Promise<unknown>) {
  const state = { settled: false, failed: false }
  void promise.then(
    () => {
      state.settled = true
    },
    () => {
      state.settled = true
      state.failed = true
    },
  )
  return state
}
