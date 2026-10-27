import { describe, expect, it, vi } from 'vitest'
import {
  type AuthorityDriftOutcome,
  createAuthorityDriftMonitor,
} from '../session-authority-drift-monitor'

function harness(options: { readonly revisionPollMs?: number; readonly safetyPollMs?: number }) {
  let revision: number | null = 1
  let tick: (() => void) | undefined
  let timers = 0
  const monitor = createAuthorityDriftMonitor({
    readRevision: () => Promise.resolve(revision),
    revisionPollMs: options.revisionPollMs ?? 500,
    safetyPollMs: options.safetyPollMs ?? 2_000,
    setTimer: (callback) => {
      timers += 1
      tick = callback
      return () => {
        tick = undefined
      }
    },
  })
  return {
    monitor,
    setRevision: (next: number | null) => {
      revision = next
    },
    tick: async () => {
      tick?.()
      await vi.waitFor(() => Promise.resolve())
      await new Promise((resolve) => setImmediate(resolve))
    },
    running: () => tick !== undefined,
    timers: () => timers,
  }
}

function watcher(outcome: () => AuthorityDriftOutcome) {
  const check = vi.fn(() => Promise.resolve(outcome()))
  const onDrift = vi.fn()
  return { check, onDrift }
}

describe('authority drift monitor', () => {
  it('shares one timer and checks Runs in full only when the authority revision moves', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const host = harness({})
      const first = watcher(() => 'current')
      const second = watcher(() => 'current')
      host.monitor.watch(first)
      host.monitor.watch(second)
      expect(host.timers()).toBe(1)

      await host.tick()
      expect(first.check).toHaveBeenCalledTimes(1)
      expect(second.check).toHaveBeenCalledTimes(1)

      // Same revision, safety interval not reached: only the one revision read.
      vi.advanceTimersByTime(500)
      await host.tick()
      expect(first.check).toHaveBeenCalledTimes(1)

      host.setRevision(2)
      vi.advanceTimersByTime(500)
      await host.tick()
      expect(first.check).toHaveBeenCalledTimes(2)
      expect(second.check).toHaveBeenCalledTimes(2)

      // The filesystem safety poll still rechecks without any write.
      vi.advanceTimersByTime(2_000)
      await host.tick()
      expect(first.check).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('interrupts only the Run whose authority changed, once, and stops when none is watched', async () => {
    const host = harness({})
    let blocked = false
    const changing = watcher(() => (blocked ? 'changed' : 'current'))
    const steady = watcher(() => 'current')
    host.monitor.watch(changing)
    const stopSteady = host.monitor.watch(steady)
    await host.tick()

    blocked = true
    host.monitor.signal()
    await host.tick()
    expect(changing.onDrift).toHaveBeenCalledExactlyOnceWith('changed')
    expect(steady.onDrift).not.toHaveBeenCalled()
    expect(host.monitor.watchedCount()).toBe(1)

    stopSteady()
    expect(host.running()).toBe(false)
  })

  it('fails closed when the revision or the check cannot be read', async () => {
    const host = harness({})
    const failing = watcher(() => {
      throw new Error('stat failed')
    })
    host.monitor.watch(failing)
    host.setRevision(null)
    await host.tick()
    expect(failing.onDrift).toHaveBeenCalledExactlyOnceWith('unverifiable')
  })
})
