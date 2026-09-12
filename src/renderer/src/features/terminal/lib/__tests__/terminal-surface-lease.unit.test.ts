import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalSurfaceLeaseManager } from '../terminal-surface-lease'

describe('terminal surface leases', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('defers detach so a destination viewport can acquire the same PTY', async () => {
    const detach = vi.fn(async () => undefined)
    const acquire = createTerminalSurfaceLeaseManager(detach)
    const releaseSource = acquire('session:1', 'terminal-1')

    releaseSource()
    const releaseDestination = acquire('session:1', 'terminal-1')
    await vi.runAllTimersAsync()

    expect(detach).not.toHaveBeenCalled()
    releaseDestination()
    await vi.runAllTimersAsync()
    expect(detach).toHaveBeenCalledExactlyOnceWith('session:1', 'terminal-1')
  })

  it('keeps the attachment until every overlapping viewport releases it', async () => {
    const detach = vi.fn(async () => undefined)
    const acquire = createTerminalSurfaceLeaseManager(detach)
    const releaseFirst = acquire('session:1', 'terminal-1')
    const releaseSecond = acquire('session:1', 'terminal-1')

    releaseFirst()
    await vi.runAllTimersAsync()
    expect(detach).not.toHaveBeenCalled()

    releaseSecond()
    releaseSecond()
    await vi.runAllTimersAsync()
    expect(detach).toHaveBeenCalledOnce()
  })

  it('detaches the migrated owner when the timer runs before the destination opens', async () => {
    const detach = vi.fn(async () => undefined)
    const acquire = createTerminalSurfaceLeaseManager(detach)
    const releaseDraft = acquire('draft:/repo', 'terminal-1')

    releaseDraft()
    acquire.migrateOwner('draft:/repo', 'session:1')
    await vi.runAllTimersAsync()

    expect(detach).toHaveBeenCalledExactlyOnceWith('session:1', 'terminal-1')

    const releaseSession = acquire('session:1', 'terminal-1')
    await vi.runAllTimersAsync()
    expect(detach).toHaveBeenCalledOnce()

    releaseSession()
    await vi.runAllTimersAsync()
    expect(detach).toHaveBeenNthCalledWith(2, 'session:1', 'terminal-1')
  })

  it('cancels the migrated detach when the destination opens before the timer', async () => {
    const detach = vi.fn(async () => undefined)
    const acquire = createTerminalSurfaceLeaseManager(detach)
    const releaseDraft = acquire('draft:/repo', 'terminal-1')

    releaseDraft()
    acquire.migrateOwner('draft:/repo', 'session:1')
    const releaseSession = acquire('session:1', 'terminal-1')
    await vi.runAllTimersAsync()

    expect(detach).not.toHaveBeenCalled()

    releaseSession()
    await vi.runAllTimersAsync()
    expect(detach).toHaveBeenCalledExactlyOnceWith('session:1', 'terminal-1')
  })

  it('shares one migrated lease when the destination opens before the source releases', async () => {
    const detach = vi.fn(async () => undefined)
    const acquire = createTerminalSurfaceLeaseManager(detach)
    const releaseDraft = acquire('draft:/repo', 'terminal-1')

    acquire.migrateOwner('draft:/repo', 'session:1')
    const releaseSession = acquire('session:1', 'terminal-1')
    releaseDraft()
    await vi.runAllTimersAsync()

    expect(detach).not.toHaveBeenCalled()

    releaseSession()
    await vi.runAllTimersAsync()
    expect(detach).toHaveBeenCalledExactlyOnceWith('session:1', 'terminal-1')
  })
})
