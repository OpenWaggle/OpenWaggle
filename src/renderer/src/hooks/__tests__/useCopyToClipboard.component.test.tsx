import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCopyToClipboard = vi.fn()

vi.mock('@/lib/ipc', () => ({
  api: {
    copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
  },
}))

import { useCopyToClipboard } from '../useCopyToClipboard'

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with copied = false', () => {
    const { result } = renderHook(() => useCopyToClipboard())
    expect(result.current.copied).toBe(false)
  })

  it('calls api.copyToClipboard and sets copied to true', () => {
    const { result } = renderHook(() => useCopyToClipboard())

    act(() => {
      result.current.copy('hello')
    })

    expect(mockCopyToClipboard).toHaveBeenCalledWith('hello')
    expect(result.current.copied).toBe(true)
  })

  it('resets copied to false after 2 seconds', () => {
    const { result } = renderHook(() => useCopyToClipboard())

    act(() => {
      result.current.copy('hello')
    })
    expect(result.current.copied).toBe(true)

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.copied).toBe(false)
  })

  it('resets timer when copy is called again before timeout', () => {
    const { result } = renderHook(() => useCopyToClipboard())

    act(() => {
      result.current.copy('first')
    })

    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(result.current.copied).toBe(true)

    act(() => {
      result.current.copy('second')
    })

    // 1500ms after second copy — should still be true (timer was reset)
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(result.current.copied).toBe(true)

    // 2000ms after second copy — now it resets
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current.copied).toBe(false)
  })
})
