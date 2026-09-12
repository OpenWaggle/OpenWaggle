import { afterEach, describe, expect, it, vi } from 'vitest'
import { releaseOwnerHandoffAfterCommit } from '../terminal-owner-handoff-release'

describe('terminal owner event handoff release', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('waits for two frames and cancels the fallback after releasing', () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame))
    const release = vi.fn()
    releaseOwnerHandoffAfterCommit(release)
    expect(release).not.toHaveBeenCalled()
    frames.shift()?.(0)
    expect(release).not.toHaveBeenCalled()
    frames.shift()?.(0)
    expect(release).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases throttled windows within one second and ignores late frames', () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame))
    const release = vi.fn()
    releaseOwnerHandoffAfterCommit(release)
    vi.advanceTimersByTime(999)
    expect(release).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(release).toHaveBeenCalledTimes(1)
    frames.shift()?.(0)
    frames.shift()?.(0)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('defers to the next microtask when frames are unavailable', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const release = vi.fn()
    releaseOwnerHandoffAfterCommit(release)
    expect(release).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(release).toHaveBeenCalledTimes(1)
  })
})
