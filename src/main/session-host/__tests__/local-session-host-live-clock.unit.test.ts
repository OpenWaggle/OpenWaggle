import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalSessionHostLiveClock } from '../local-session-host-live-clock'

describe('LocalSessionHostLiveClock', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('leaves out the time the event loop was blocked, before and after the next tick', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let wall = 1_000
    const clock = new LocalSessionHostLiveClock(() => wall, 25, 25)
    clock.start()
    const startedAt = clock.now()
    wall += 25
    vi.advanceTimersByTime(25)
    expect(clock.now() - startedAt).toBe(25)

    // Blocked for 1 s: no tick ran meanwhile.
    wall += 1_000
    expect(clock.now() - startedAt).toBe(75)
    vi.advanceTimersByTime(25)
    expect(clock.now() - startedAt).toBe(75)

    wall += 25
    vi.advanceTimersByTime(25)
    expect(clock.now() - startedAt).toBe(100)
    clock.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('counts every millisecond as live while it is stopped', () => {
    let wall = 0
    const clock = new LocalSessionHostLiveClock(() => wall)
    const startedAt = clock.now()
    wall += 5_000
    expect(clock.now() - startedAt).toBe(5_000)
  })
})
