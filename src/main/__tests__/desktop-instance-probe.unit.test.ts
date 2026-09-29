import { describe, expect, it, vi } from 'vitest'
import { isDesktopAppRunning, isDesktopInstanceProbe } from '../desktop-instance-probe'

describe('desktop instance probe', () => {
  it('releases the lock it wins, so a closed desktop app can still start', () => {
    const lock = {
      requestSingleInstanceLock: vi.fn(() => true),
      releaseSingleInstanceLock: vi.fn(),
    }

    expect(isDesktopAppRunning(lock)).toBe(false)
    expect(lock.releaseSingleInstanceLock).toHaveBeenCalledOnce()
  })

  it('reports a running desktop app without taking its lock', () => {
    const lock = {
      requestSingleInstanceLock: vi.fn(() => false),
      releaseSingleInstanceLock: vi.fn(),
    }

    expect(isDesktopAppRunning(lock)).toBe(true)
    expect(lock.releaseSingleInstanceLock).not.toHaveBeenCalled()
  })

  it('recognizes only its own probe data', () => {
    expect(isDesktopInstanceProbe({ openwaggleInstanceProbe: 'update-cli' })).toBe(true)
    expect(isDesktopInstanceProbe({})).toBe(false)
    expect(isDesktopInstanceProbe(undefined)).toBe(false)
  })
})
