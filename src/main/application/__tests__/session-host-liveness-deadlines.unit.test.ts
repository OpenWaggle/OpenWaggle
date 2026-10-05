import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionHostLiveness } from '../session-host-liveness'

describe('Session Host idle and stop deadlines', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps its idle deadline when the settings refresh repeats the same grace period', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 1000, requestShutdown })
    liveness.acquire('client')()

    // The Host re-reads its settings every second; an unchanged value must not restart the timer.
    for (let elapsed = 0; elapsed < 1000; elapsed += 100) {
      liveness.updateIdleGracePeriod(1000)
      await vi.advanceTimersByTimeAsync(100)
    }

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('does not let background preparation polls keep an idle Host alive', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 1000, requestShutdown })
    liveness.acquire('client')()

    // Semantic discovery checks for work every two seconds, holding the Host while it checks.
    for (let elapsed = 0; elapsed < 900; elapsed += 100) {
      liveness.acquire('semantic-preparation')()
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(requestShutdown).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('still holds an idle Host open while a preparation batch runs', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 1000, requestShutdown })
    liveness.acquire('client')()
    const releasePreparation = liveness.acquire('semantic-preparation')

    await vi.advanceTimersByTimeAsync(5000)
    expect(requestShutdown).not.toHaveBeenCalled()
    releasePreparation()
    await vi.advanceTimersByTimeAsync(0)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('restarts the idle grace after real work', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 1000, requestShutdown })
    liveness.acquire('client')()
    await vi.advanceTimersByTimeAsync(900)

    liveness.acquire('operation')()
    await vi.advanceTimersByTimeAsync(999)
    expect(requestShutdown).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('counts time already spent idle when the grace period grows', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 1000, requestShutdown })
    liveness.acquire('client')()
    await vi.advanceTimersByTimeAsync(600)

    liveness.updateIdleGracePeriod(2000)
    await vi.advanceTimersByTimeAsync(1399)
    expect(requestShutdown).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('ends a drain at its deadline even while work still holds the Host', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
    liveness.acquire('action-run')

    liveness.requestDrain('stop', { deadlineMs: 1000 })
    await vi.advanceTimersByTimeAsync(999)
    expect(requestShutdown).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('lets a later stop with a deadline bound a drain that is already running', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
    liveness.acquire('run')
    liveness.requestDrain('stop')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(requestShutdown).not.toHaveBeenCalled()

    liveness.requestDrain('stop', { deadlineMs: 500 })
    await vi.advanceTimersByTimeAsync(500)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('finishes a bounded drain early once its work ends', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
    const releaseRun = liveness.acquire('run')

    liveness.requestDrain('stop', { deadlineMs: 1000 })
    releaseRun()
    expect(requestShutdown).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })
})
