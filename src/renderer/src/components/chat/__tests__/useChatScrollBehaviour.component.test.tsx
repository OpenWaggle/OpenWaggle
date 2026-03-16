import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatScrollBehaviour } from '../hooks/useChatScrollBehaviour'

function createDefaultParams(
  overrides: Partial<Parameters<typeof useChatScrollBehaviour>[0]> = {},
) {
  return {
    lastUserMessageId: null,
    messagesLength: 0,
    rowsLength: 0,
    isLoading: false,
    activeConversationId: 'conv-1',
    ...overrides,
  }
}

describe('useChatScrollBehaviour', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns scrollerRef, spacerRef, userMessageRef, and handleScroll', () => {
    const { result } = renderHook(() => useChatScrollBehaviour(createDefaultParams()))
    expect(result.current.scrollerRef).toBeDefined()
    expect(result.current.spacerRef).toBeDefined()
    expect(result.current.userMessageRef).toBeDefined()
    expect(result.current.handleScroll).toBeTypeOf('function')
  })

  it('handleScroll adds is-scrolling class to the element', () => {
    const { result } = renderHook(() => useChatScrollBehaviour(createDefaultParams()))

    const div = document.createElement('div')
    Object.defineProperty(result.current.scrollerRef, 'current', {
      value: div,
      writable: true,
    })

    act(() => {
      result.current.handleScroll()
    })

    expect(div.classList.contains('is-scrolling')).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1200)
    })

    expect(div.classList.contains('is-scrolling')).toBe(false)
  })

  it('scrolls to bottom on initial load when rows appear', () => {
    const div = document.createElement('div')
    Object.defineProperty(div, 'scrollHeight', { value: 500, configurable: true })
    div.scrollTop = 0

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        Object.defineProperty(hookResult.scrollerRef, 'current', {
          value: div,
          writable: true,
          configurable: true,
        })
        return hookResult
      },
      { initialProps: createDefaultParams({ rowsLength: 0 }) },
    )

    // Assign the ref before re-render with rows
    Object.defineProperty(result.current.scrollerRef, 'current', {
      value: div,
      writable: true,
      configurable: true,
    })

    rerender(createDefaultParams({ rowsLength: 5 }))

    expect(div.scrollTop).toBe(500)
  })

  it('auto-scrolls when isLoading and rows grow and near bottom', () => {
    const div = document.createElement('div')
    Object.defineProperty(div, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(div, 'clientHeight', { value: 500, configurable: true })
    div.scrollTop = 480 // distanceFromBottom = 1000 - 480 - 500 = 20 < 50

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        Object.defineProperty(hookResult.scrollerRef, 'current', {
          value: div,
          writable: true,
          configurable: true,
        })
        return hookResult
      },
      { initialProps: createDefaultParams({ isLoading: true, rowsLength: 5 }) },
    )

    Object.defineProperty(result.current.scrollerRef, 'current', {
      value: div,
      writable: true,
      configurable: true,
    })

    rerender(createDefaultParams({ isLoading: true, rowsLength: 6 }))

    expect(div.scrollTop).toBe(1000)
  })

  it('does NOT auto-scroll when distanceFromBottom > 50', () => {
    const div = document.createElement('div')
    Object.defineProperty(div, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(div, 'clientHeight', { value: 500, configurable: true })

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        Object.defineProperty(hookResult.scrollerRef, 'current', {
          value: div,
          writable: true,
          configurable: true,
        })
        return hookResult
      },
      { initialProps: createDefaultParams({ isLoading: true, rowsLength: 5 }) },
    )

    Object.defineProperty(result.current.scrollerRef, 'current', {
      value: div,
      writable: true,
      configurable: true,
    })

    // After initial load scroll-to-bottom fires (scrollTop = 1000),
    // simulate user scrolling up so distanceFromBottom > 50.
    div.scrollTop = 100

    rerender(createDefaultParams({ isLoading: true, rowsLength: 6 }))

    expect(div.scrollTop).toBe(100)
  })

  it('resets spacer height when activeConversationId changes', () => {
    const spacerDiv = document.createElement('div')
    spacerDiv.style.height = '200px'

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        Object.defineProperty(hookResult.spacerRef, 'current', {
          value: spacerDiv,
          writable: true,
          configurable: true,
        })
        return hookResult
      },
      { initialProps: createDefaultParams({ activeConversationId: 'conv-1' }) },
    )

    Object.defineProperty(result.current.spacerRef, 'current', {
      value: spacerDiv,
      writable: true,
      configurable: true,
    })

    rerender(createDefaultParams({ activeConversationId: 'conv-2' }))

    expect(spacerDiv.style.height).toBe('0px')
  })
})
