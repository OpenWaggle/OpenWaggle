import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForNotLoading } from './wait-for-not-loading'

const MAX_WAIT_MS = 10_000
const POLL_MS = 50
const HALF_WAIT_MS = 500
const QUICK_RELEASE_MS = 200
const MICROTASK_FLUSH_COUNT = 2

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < MICROTASK_FLUSH_COUNT; i++) {
    await Promise.resolve()
  }
}

describe('waitForNotLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately when already not loading', async () => {
    const loadingRef = { current: false }

    await expect(waitForNotLoading(loadingRef)).resolves.toBeUndefined()
  })

  it('waits until loading flips to false', async () => {
    const loadingRef = { current: true }
    const waitPromise = waitForNotLoading(loadingRef)

    vi.advanceTimersByTime(HALF_WAIT_MS)
    await flushMicrotasks()

    let settled = false
    void waitPromise.then(() => {
      settled = true
    })

    expect(settled).toBe(false)

    setTimeout(() => {
      loadingRef.current = false
    }, QUICK_RELEASE_MS)

    vi.advanceTimersByTime(QUICK_RELEASE_MS + POLL_MS)
    await flushMicrotasks()

    await expect(waitPromise).resolves.toBeUndefined()
  })

  it('resolves after max wait timeout when loading stays true', async () => {
    const loadingRef = { current: true }
    const waitPromise = waitForNotLoading(loadingRef)

    vi.advanceTimersByTime(MAX_WAIT_MS + POLL_MS)
    await flushMicrotasks()

    await expect(waitPromise).resolves.toBeUndefined()
  })
})
