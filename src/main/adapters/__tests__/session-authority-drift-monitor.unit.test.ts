import { describe, expect, it, vi } from 'vitest'
import {
  type AuthorityDriftOutcome,
  createAuthorityDriftMonitor,
} from '../session-authority-drift-monitor'

function harness(options: {
  readonly revisionPollMs?: number
  readonly safetyPollMs?: number
  /** Use the monitor's own clock instead of the test's. */
  readonly ownClock?: boolean
}) {
  let revision: number | null = 1
  let tick: (() => void) | undefined
  let timers = 0
  let clock = 0
  const monitor = createAuthorityDriftMonitor({
    readRevision: () => Promise.resolve(revision),
    revisionPollMs: options.revisionPollMs ?? 500,
    safetyPollMs: options.safetyPollMs ?? 2_000,
    ...(options.ownClock ? {} : { now: () => clock }),
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
    advance: (ms: number) => {
      clock += ms
    },
  }
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve))
}

function watcher(outcome: () => AuthorityDriftOutcome) {
  const check = vi.fn(() => Promise.resolve(outcome()))
  const onDrift = vi.fn()
  return { check, onDrift }
}

describe('authority drift monitor', () => {
  it('shares one timer and checks Runs in full only when the authority revision moves', async () => {
    const host = harness({})
    const first = watcher(() => 'current')
    const second = watcher(() => 'current')
    host.monitor.watch(first)
    host.monitor.watch(second)
    expect(host.timers()).toBe(1)
    // Each Run is checked as soon as it is watched.
    await settle()
    expect(first.check).toHaveBeenCalledTimes(1)
    expect(second.check).toHaveBeenCalledTimes(1)

    // The first revision read is a change.
    await host.tick()
    expect(first.check).toHaveBeenCalledTimes(2)
    expect(second.check).toHaveBeenCalledTimes(2)

    // Same revision, safety interval not reached: only the one revision read.
    host.advance(500)
    await host.tick()
    expect(first.check).toHaveBeenCalledTimes(2)

    host.setRevision(2)
    host.advance(500)
    await host.tick()
    expect(first.check).toHaveBeenCalledTimes(3)
    expect(second.check).toHaveBeenCalledTimes(3)

    // The filesystem safety poll still rechecks without any write.
    host.advance(2_000)
    await host.tick()
    expect(first.check).toHaveBeenCalledTimes(4)
  })

  it('checks a Run again when the revision moves while its check is in flight', async () => {
    const host = harness({})
    const pending: Array<(outcome: AuthorityDriftOutcome) => void> = []
    let revoked = false
    const check = vi.fn(
      () =>
        new Promise<AuthorityDriftOutcome>((resolve) => {
          pending.push(resolve)
        }),
    )
    const onDrift = vi.fn()
    host.monitor.watch({ check, onDrift })
    await settle()
    expect(check).toHaveBeenCalledTimes(1)
    pending.shift()?.('current')
    await settle()

    await host.tick()
    expect(check).toHaveBeenCalledTimes(2)
    // A revocation lands after the in-flight check read the authority it still allows.
    revoked = true
    host.setRevision(2)
    host.advance(500)
    await host.tick()
    pending.shift()?.('current')
    await settle()

    // Checked again at once, not at the next safety poll.
    expect(check).toHaveBeenCalledTimes(3)
    pending.shift()?.(revoked ? 'changed' : 'current')
    await settle()
    expect(onDrift).toHaveBeenCalledExactlyOnceWith('changed')
  })

  it('keeps its safety poll when the wall clock moves backwards', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const host = harness({ safetyPollMs: 5, ownClock: true })
      const run = watcher(() => 'current')
      host.monitor.watch(run)
      await host.tick()
      const checks = run.check.mock.calls.length
      vi.setSystemTime(Date.now() - 3_600_000)
      await new Promise((resolve) => setTimeout(resolve, 20))
      await host.tick()
      expect(run.check).toHaveBeenCalledTimes(checks + 1)
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
