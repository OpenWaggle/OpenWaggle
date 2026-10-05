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

  it('counts idle time from the last real work even while preparation outlasts it', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 1000, requestShutdown })
    const releasePreparation = liveness.acquire('semantic-preparation')
    liveness.acquire('client')()

    await vi.advanceTimersByTimeAsync(600)
    releasePreparation()
    await vi.advanceTimersByTimeAsync(399)
    expect(requestShutdown).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

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
    liveness.acquire('wait')
    liveness.requestDrain('stop')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(requestShutdown).not.toHaveBeenCalled()

    liveness.requestDrain('stop', { deadlineMs: 500 })
    await vi.advanceTimersByTimeAsync(500)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('interrupts Runs at the deadline and stops as soon as they end', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    let releaseRun: () => void = () => undefined
    const interruptRunsAtDrainDeadline = vi.fn(() => releaseRun())
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown,
      interruptRunsAtDrainDeadline,
    })
    releaseRun = liveness.acquire('run')
    liveness.acquire('action-run')

    liveness.requestDrain('stop', { deadlineMs: 1000 })
    await vi.advanceTimersByTimeAsync(999)
    expect(interruptRunsAtDrainDeadline).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    // The Run ended as interrupted; the Action alone no longer holds the Host past its deadline.
    expect(interruptRunsAtDrainDeadline).toHaveBeenCalledOnce()
    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('stops after the settle when an interrupted Run does not end', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown,
      interruptRunsAtDrainDeadline: vi.fn(),
      drainDeadlineSettleMs: 500,
    })
    liveness.acquire('run')

    liveness.requestDrain('stop', { deadlineMs: 1000 })
    await vi.advanceTimersByTimeAsync(1499)
    expect(requestShutdown).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('retries a failed deadline shutdown even while a client connects', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('endpoint cleanup failed'))
      .mockResolvedValue(undefined)
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
    liveness.acquire('action-run')
    liveness.requestDrain('stop', { deadlineMs: 100 })
    await vi.advanceTimersByTimeAsync(100)
    expect(requestShutdown).toHaveBeenCalledOnce()

    liveness.acquire('client')
    await vi.advanceTimersByTimeAsync(250)

    expect(requestShutdown).toHaveBeenCalledTimes(2)
  })

  it('keeps the startup grace and client handoff through background polls', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 0,
      clientHandoffGracePeriodMs: 500,
      requestShutdown,
    })
    liveness.armIdleShutdown(1000)
    for (let elapsed = 0; elapsed < 900; elapsed += 100) {
      liveness.acquire('semantic-preparation')()
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(requestShutdown).not.toHaveBeenCalled()

    liveness.acquire('client')()
    liveness.acquire('semantic-preparation')()
    await vi.advanceTimersByTimeAsync(499)
    expect(requestShutdown).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('keeps a client handoff grace when the idle setting changes', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      clientHandoffGracePeriodMs: 500,
      requestShutdown,
    })
    // A CLI lowers the grace and disconnects; the next settings read sees the new value.
    liveness.acquire('client')()
    liveness.updateIdleGracePeriod(0)
    await vi.advanceTimersByTimeAsync(499)
    expect(requestShutdown).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('keeps the startup grace when a preparation batch is running at startup', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 0, requestShutdown })
    const releasePreparation = liveness.acquire('semantic-preparation')

    liveness.armIdleShutdown(1000)
    await vi.advanceTimersByTimeAsync(200)
    releasePreparation()
    await vi.advanceTimersByTimeAsync(799)
    expect(requestShutdown).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('keeps the drain deadline when an early shutdown fails and is retried', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('endpoint cleanup failed'))
      .mockResolvedValue(undefined)
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
    const releaseRun = liveness.acquire('run')
    liveness.requestDrain('stop', { deadlineMs: 1000 })
    releaseRun()
    expect(requestShutdown).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(0)

    // An Action admitted meanwhile still cannot outlast the deadline.
    liveness.acquire('action-run', { whileDraining: true })
    await vi.advanceTimersByTimeAsync(250)
    expect(requestShutdown).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(750)

    expect(requestShutdown).toHaveBeenCalledTimes(2)
  })

  it('rejects an invalid deadline without starting a drain', () => {
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 1000, requestShutdown: vi.fn() })

    expect(() => liveness.requestDrain('stop', { deadlineMs: -1 })).toThrow('drain deadline')
    expect(liveness.isDraining()).toBe(false)
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
