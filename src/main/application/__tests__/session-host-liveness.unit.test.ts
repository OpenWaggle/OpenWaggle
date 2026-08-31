import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import { SessionHostEventHub } from '../session-host-event-hub'
import { SessionHostLiveness } from '../session-host-liveness'
import { acquireSessionHostRunLease } from '../session-host-run-admission'

describe('Session Host liveness', () => {
  afterEach(() => vi.useRealTimers())

  it('shuts down only after the final owner releases and the grace period elapses', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 5000, requestShutdown })
    const releaseClient = liveness.acquire('client')
    const releaseRun = liveness.acquire('run')

    releaseClient()
    await vi.advanceTimersByTimeAsync(5000)
    expect(requestShutdown).not.toHaveBeenCalled()
    releaseRun()
    expect(liveness.hasScheduledIdleShutdown()).toBe(true)
    await vi.advanceTimersByTimeAsync(4999)
    expect(requestShutdown).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('cancels pending idle shutdown when a new wait or subscription arrives', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 100, requestShutdown })
    const releaseClient = liveness.acquire('client')
    releaseClient()
    await vi.advanceTimersByTimeAsync(50)
    const releaseWait = liveness.acquire('wait')
    await vi.advanceTimersByTimeAsync(100)

    expect(requestShutdown).not.toHaveBeenCalled()
    releaseWait()
    await vi.advanceTimersByTimeAsync(100)
    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('keeps a zero-idle Host alive across a client probe-to-command handoff', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 0,
      clientHandoffGracePeriodMs: 1000,
      requestShutdown,
    })
    const releaseProbe = liveness.acquire('client')
    releaseProbe()
    await vi.advanceTimersByTimeAsync(999)
    expect(requestShutdown).not.toHaveBeenCalled()

    const releaseCommand = liveness.acquire('client')
    await vi.advanceTimersByTimeAsync(1)
    expect(requestShutdown).not.toHaveBeenCalled()
    releaseCommand()
    await vi.advanceTimersByTimeAsync(1000)
    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('reschedules an idle Host when the configured grace period changes', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 1000, requestShutdown })
    const release = liveness.acquire('semantic-preparation')
    release()
    await vi.advanceTimersByTimeAsync(500)

    liveness.updateIdleGracePeriod(50)
    await vi.advanceTimersByTimeAsync(50)

    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('treats release as idempotent and close as final', () => {
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 1000,
      requestShutdown: vi.fn(),
    })
    const release = liveness.acquire('export')
    release()
    release()
    expect(liveness.ownerCount()).toBe(0)

    liveness.close()
    expect(() => liveness.acquire('client')).toThrow('no longer accepting')
  })

  it('drains as soon as work owners release without waiting for connected clients', () => {
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
    liveness.acquire('client')
    liveness.acquire('subscription')
    const releaseRun = liveness.acquire('run')

    liveness.requestDrain()
    expect(liveness.isDraining()).toBe(true)
    expect(liveness.drainReason()).toBe('recovery')
    expect(requestShutdown).not.toHaveBeenCalled()
    expect(() => liveness.acquire('operation')).toThrow('no longer accepting')

    releaseRun()
    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('records upgrade retirement separately from recovery drains', () => {
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 0, requestShutdown })

    liveness.requestDrain('upgrade')

    expect(liveness.drainReason()).toBe('upgrade')
    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('contains a rejected shutdown and retries it without an unhandled rejection', async () => {
    vi.useFakeTimers()
    const requestShutdown = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('endpoint cleanup failed'))
      .mockResolvedValue(undefined)
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 0, requestShutdown })

    liveness.armIdleShutdown()
    await vi.advanceTimersByTimeAsync(0)
    expect(requestShutdown).toHaveBeenCalledOnce()
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(250)

    expect(requestShutdown).toHaveBeenCalledTimes(2)
  })

  it('rejects new Run and export leases once a Host drain starts', async () => {
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    const releaseExistingRun = liveness.acquire('run')
    const releaseRuntime = installSessionHostEventRuntime({
      eventHub: new SessionHostEventHub(),
      liveness,
    })
    try {
      liveness.requestDrain()
      await expect(
        Effect.runPromise(Effect.flip(acquireSessionHostRunLease('run'))),
      ).resolves.toMatchObject({
        code: 'host_draining',
        retryable: true,
      })
      await expect(
        Effect.runPromise(Effect.flip(acquireSessionHostRunLease('export'))),
      ).resolves.toMatchObject({
        code: 'host_draining',
        retryable: true,
      })
    } finally {
      releaseRuntime()
      releaseExistingRun()
    }
  })
})
