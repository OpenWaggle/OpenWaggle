// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultParams,
  createTestLayout,
  flushAnimationFrame,
  installChatScrollTestEnvironment,
  renderScrollHook,
  triggerObservedResize,
} from './useChatScrollBehaviour.test-utils'

describe('useChatScrollBehaviour auto-scroll behavior', () => {
  installChatScrollTestEnvironment()

  it('returns the public API', () => {
    const layout = createTestLayout()
    const { result } = renderScrollHook(createDefaultParams(), layout)

    expect(result.current.scrollerRef).toBeDefined()
    expect(result.current.contentRef).toBeDefined()
    expect(typeof result.current.showScrollbar).toBe('boolean')
    expect(typeof result.current.showScrollToBottom).toBe('boolean')
    expect(typeof result.current.scrollToBottom).toBe('function')
    expect(typeof result.current.handleScroll).toBe('function')
    expect(typeof result.current.handleWheel).toBe('function')
    expect(typeof result.current.handlePointerDown).toBe('function')
    expect(typeof result.current.handleTouchStart).toBe('function')
  })

  it('sticks to the bottom when a user sends a message', () => {
    const onConsumed = vi.fn()
    const layout = createTestLayout({
      naturalScrollHeight: 1000,
      clientHeight: 500,
      scrollTop: 120,
    })

    const { result } = renderScrollHook(
      createDefaultParams({
        isLoading: true,
        userDidSend: true,
        onUserDidSendConsumed: onConsumed,
      }),
      layout,
    )

    expect(layout.getScrollTop()).toBe(500)
    expect(layout.scrollToMock).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' })
    expect(result.current.showScrollToBottom).toBe(false)
    expect(onConsumed).toHaveBeenCalledTimes(1)
  })

  it('follows streaming growth while auto-scroll is enabled', () => {
    const layout = createTestLayout({ naturalScrollHeight: 1000, clientHeight: 500 })
    renderScrollHook(createDefaultParams(), layout)

    layout.setNaturalScrollHeight(1200)
    triggerObservedResize()
    flushAnimationFrame()

    expect(layout.getScrollTop()).toBe(700)
  })

  it('follows streaming content updates even when row count does not change', () => {
    const layout = createTestLayout({ naturalScrollHeight: 1000, clientHeight: 500 })
    const { rerender } = renderScrollHook(
      createDefaultParams({ isLoading: true, rowsLength: 2, streamVersion: 10 }),
      layout,
    )

    layout.setNaturalScrollHeight(1200)
    rerender(createDefaultParams({ isLoading: true, rowsLength: 2, streamVersion: 11 }))
    flushAnimationFrame()

    expect(layout.getScrollTop()).toBe(700)
  })

  it('scrollToBottom re-enables follow mode with smooth scrolling', () => {
    const layout = createTestLayout({ naturalScrollHeight: 1000, clientHeight: 500 })
    const { result } = renderScrollHook(createDefaultParams(), layout)

    layout.setScrollTop(300)
    act(() => {
      result.current.handleWheel({ deltaY: -120 })
      result.current.handleScroll()
    })

    act(() => {
      result.current.scrollToBottom()
    })

    expect(layout.getScrollTop()).toBe(500)
    expect(result.current.showScrollToBottom).toBe(false)
    expect(layout.scrollToMock).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' })
  })
})
