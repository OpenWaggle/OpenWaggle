import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserPreviewCrashRecovery,
  isRecoverableBrowserPreviewCrash,
} from '../browser-preview-crash-recovery'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BrowserPreviewCrashRecovery', () => {
  it('tries three reloads with 250ms exponential backoff and then stops', async () => {
    const recover = vi.fn()
    const onExhausted = vi.fn()
    const recovery = new BrowserPreviewCrashRecovery({
      isCurrent: () => true,
      recover,
      onExhausted,
    })

    recovery.start()
    await vi.advanceTimersByTimeAsync(249)
    expect(recover).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(recover).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(499)
    expect(recover).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(recover).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(recover).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(250)

    expect(onExhausted).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels pending attempts when navigation starts', async () => {
    const recover = vi.fn()
    const onExhausted = vi.fn()
    const recovery = new BrowserPreviewCrashRecovery({
      isCurrent: () => true,
      recover,
      onExhausted,
    })

    recovery.start()
    await vi.advanceTimersByTimeAsync(250)
    recovery.navigationStarted()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(recover).toHaveBeenCalledOnce()
    expect(onExhausted).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does nothing after replacement or disposal', async () => {
    let current = true
    const recover = vi.fn()
    const onExhausted = vi.fn()
    const recovery = new BrowserPreviewCrashRecovery({
      isCurrent: () => current,
      recover,
      onExhausted,
    })

    recovery.start()
    current = false
    await vi.advanceTimersByTimeAsync(250)
    current = true
    recovery.start()
    recovery.dispose()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(recover).not.toHaveBeenCalled()
    expect(onExhausted).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the three-attempt limit for crashes within 30 seconds', async () => {
    const recover = vi.fn()
    const onExhausted = vi.fn()
    const recovery = new BrowserPreviewCrashRecovery({
      isCurrent: () => true,
      recover,
      onExhausted,
    })

    for (let crash = 0; crash < 3; crash += 1) {
      recovery.start()
      await vi.advanceTimersByTimeAsync(250 * 2 ** crash)
      recovery.navigationStarted()
    }
    recovery.start()

    expect(recover).toHaveBeenCalledTimes(3)
    expect(onExhausted).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts a fresh recovery budget after 30 seconds', async () => {
    const recover = vi.fn()
    const onExhausted = vi.fn()
    const recovery = new BrowserPreviewCrashRecovery({
      isCurrent: () => true,
      recover,
      onExhausted,
    })

    recovery.start()
    await vi.advanceTimersByTimeAsync(250)
    recovery.navigationStarted()
    await vi.advanceTimersByTimeAsync(30_000)
    recovery.start()
    await vi.advanceTimersByTimeAsync(250)

    expect(recover).toHaveBeenCalledTimes(2)
    expect(onExhausted).not.toHaveBeenCalled()
  })
})

describe('isRecoverableBrowserPreviewCrash', () => {
  it.each(['crashed', 'oom', 'abnormal-exit'])('recovers %s renderer exits', (reason) => {
    expect(isRecoverableBrowserPreviewCrash(reason)).toBe(true)
  })

  it.each(['clean-exit', 'killed', 'launch-failed', 'integrity-failure'])(
    'does not reload-loop after %s renderer exits',
    (reason) => {
      expect(isRecoverableBrowserPreviewCrash(reason)).toBe(false)
    },
  )
})
