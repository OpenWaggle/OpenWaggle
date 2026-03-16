import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThrottledStreamText } from '../useThrottledStreamText'

const RAF_DELAY_MS = 16

describe('useThrottledStreamText', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) =>
      window.setTimeout(() => cb(performance.now()), RAF_DELAY_MS),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => window.clearTimeout(id))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns text immediately when not streaming', () => {
    const { result } = renderHook(() => useThrottledStreamText('hello', false))
    expect(result.current).toBe('hello')
  })

  it('updates immediately when text changes and not streaming', () => {
    const { result, rerender } = renderHook(
      ({ text, isStreaming }: { text: string; isStreaming: boolean }) =>
        useThrottledStreamText(text, isStreaming),
      { initialProps: { text: 'hello', isStreaming: false } },
    )
    expect(result.current).toBe('hello')
    rerender({ text: 'world', isStreaming: false })
    expect(result.current).toBe('world')
  })

  it('batches updates behind rAF when streaming', async () => {
    const { result, rerender } = renderHook(
      ({ text, isStreaming }: { text: string; isStreaming: boolean }) =>
        useThrottledStreamText(text, isStreaming),
      { initialProps: { text: 'hello', isStreaming: true } },
    )

    // Text changes during streaming — display should not update immediately
    rerender({ text: 'hello world', isStreaming: true })
    expect(result.current).toBe('hello')

    // After rAF fires, display updates to latest text
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RAF_DELAY_MS)
    })
    expect(result.current).toBe('hello world')
  })

  it('coalesces multiple rapid updates into one rAF flush', async () => {
    const { result, rerender } = renderHook(
      ({ text, isStreaming }: { text: string; isStreaming: boolean }) =>
        useThrottledStreamText(text, isStreaming),
      { initialProps: { text: 'a', isStreaming: true } },
    )

    // Multiple rapid updates before rAF fires
    rerender({ text: 'ab', isStreaming: true })
    rerender({ text: 'abc', isStreaming: true })
    rerender({ text: 'abcd', isStreaming: true })

    // Still showing stale text
    expect(result.current).toBe('a')

    // One rAF flush brings us to the latest
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RAF_DELAY_MS)
    })
    expect(result.current).toBe('abcd')
  })

  it('flushes immediately when streaming stops', async () => {
    const { result, rerender } = renderHook(
      ({ text, isStreaming }: { text: string; isStreaming: boolean }) =>
        useThrottledStreamText(text, isStreaming),
      { initialProps: { text: 'partial', isStreaming: true } },
    )

    // Update while streaming — not yet reflected
    rerender({ text: 'complete response', isStreaming: true })
    expect(result.current).toBe('partial')

    // Stream ends — immediate flush, no waiting for rAF
    rerender({ text: 'complete response', isStreaming: false })
    expect(result.current).toBe('complete response')
  })

  it('cancels pending rAF when streaming stops', async () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')

    const { rerender } = renderHook(
      ({ text, isStreaming }: { text: string; isStreaming: boolean }) =>
        useThrottledStreamText(text, isStreaming),
      { initialProps: { text: 'hello', isStreaming: true } },
    )

    // Trigger a pending rAF
    rerender({ text: 'hello world', isStreaming: true })

    // Stop streaming — pending rAF should be cancelled
    rerender({ text: 'hello world', isStreaming: false })
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('cancels pending rAF on unmount', async () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')

    const { unmount, rerender } = renderHook(
      ({ text, isStreaming }: { text: string; isStreaming: boolean }) =>
        useThrottledStreamText(text, isStreaming),
      { initialProps: { text: 'hello', isStreaming: true } },
    )

    rerender({ text: 'hello world', isStreaming: true })
    unmount()

    expect(cancelSpy).toHaveBeenCalled()
  })
})
