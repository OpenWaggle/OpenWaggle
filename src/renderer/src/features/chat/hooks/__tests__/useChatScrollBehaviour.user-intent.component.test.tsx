// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  createDefaultParams,
  createTestLayout,
  flushAnimationFrame,
  installChatScrollTestEnvironment,
  renderScrollHook,
  triggerObservedResize,
} from './useChatScrollBehaviour.test-utils'

describe('useChatScrollBehaviour user intent behavior', () => {
  installChatScrollTestEnvironment()

  it('cancels a queued stream follow immediately when the user wheels upward', () => {
    const layout = createTestLayout({ naturalScrollHeight: 1000, clientHeight: 500 })
    const { result, rerender } = renderScrollHook(
      createDefaultParams({ isLoading: true, rowsLength: 2, streamVersion: 10 }),
      layout,
    )

    layout.setNaturalScrollHeight(1200)
    rerender(createDefaultParams({ isLoading: true, rowsLength: 2, streamVersion: 11 }))
    act(() => {
      result.current.handleWheel({ deltaY: -40 })
    })
    flushAnimationFrame()

    expect(layout.getScrollTop()).toBe(500)
    expect(result.current.showScrollToBottom).toBe(true)
  })

  it('cancels a queued stream follow immediately when the user touches upward', () => {
    const layout = createTestLayout({ naturalScrollHeight: 1000, clientHeight: 500 })
    const { result, rerender } = renderScrollHook(
      createDefaultParams({ isLoading: true, rowsLength: 2, streamVersion: 10 }),
      layout,
    )

    layout.setNaturalScrollHeight(1200)
    rerender(createDefaultParams({ isLoading: true, rowsLength: 2, streamVersion: 11 }))
    act(() => {
      result.current.handleTouchStart({ touches: [{ clientY: 100 }] })
      result.current.handleTouchMove({ touches: [{ clientY: 140 }] })
    })
    flushAnimationFrame()

    expect(layout.getScrollTop()).toBe(500)
    expect(result.current.showScrollToBottom).toBe(true)
  })

  it('opts out of stream follow when the user wheels upward away from bottom', () => {
    const layout = createTestLayout({ naturalScrollHeight: 1000, clientHeight: 500 })
    const { result } = renderScrollHook(createDefaultParams(), layout)

    layout.setScrollTop(300)
    act(() => {
      result.current.handleWheel({ deltaY: -120 })
      result.current.handleScroll()
    })

    layout.setNaturalScrollHeight(1300)
    triggerObservedResize()
    flushAnimationFrame()

    expect(layout.getScrollTop()).toBe(300)
    expect(result.current.showScrollToBottom).toBe(true)
  })

  it('does not follow streaming content updates after the user opts out', () => {
    const layout = createTestLayout({ naturalScrollHeight: 1000, clientHeight: 500 })
    const { result, rerender } = renderScrollHook(
      createDefaultParams({ isLoading: true, rowsLength: 2, streamVersion: 10 }),
      layout,
    )

    layout.setScrollTop(300)
    act(() => {
      result.current.handleWheel({ deltaY: -120 })
      result.current.handleScroll()
    })

    layout.setNaturalScrollHeight(1300)
    rerender(createDefaultParams({ isLoading: true, rowsLength: 2, streamVersion: 11 }))
    flushAnimationFrame()

    expect(layout.getScrollTop()).toBe(300)
  })

  it('re-enters stream follow when the user scrolls back near the bottom', () => {
    const layout = createTestLayout({ naturalScrollHeight: 1000, clientHeight: 500 })
    const { result } = renderScrollHook(createDefaultParams(), layout)

    layout.setScrollTop(300)
    act(() => {
      result.current.handleWheel({ deltaY: -120 })
      result.current.handleScroll()
    })
    layout.setScrollTop(500)
    act(() => {
      result.current.handleScroll()
    })

    layout.setNaturalScrollHeight(1300)
    triggerObservedResize()
    flushAnimationFrame()

    expect(result.current.showScrollToBottom).toBe(false)
    expect(layout.getScrollTop()).toBe(800)
  })

  it('opts out for pointer scrollbar drags and touch upward gestures', () => {
    const pointerLayout = createTestLayout({ naturalScrollHeight: 1000, clientHeight: 500 })
    const pointerHook = renderScrollHook(createDefaultParams(), pointerLayout)

    pointerLayout.setScrollTop(250)
    act(() => {
      pointerHook.result.current.handlePointerDown()
      pointerHook.result.current.handleScroll()
      pointerHook.result.current.handlePointerUp()
    })
    expect(pointerHook.result.current.showScrollToBottom).toBe(true)

    const touchLayout = createTestLayout({ naturalScrollHeight: 1000, clientHeight: 500 })
    const touchHook = renderScrollHook(
      createDefaultParams({ activeSessionId: 'session-touch' }),
      touchLayout,
    )

    touchLayout.setScrollTop(250)
    act(() => {
      touchHook.result.current.handleTouchStart({ touches: [{ clientY: 100 }] })
      touchHook.result.current.handleTouchMove({ touches: [{ clientY: 140 }] })
      touchHook.result.current.handleScroll()
      touchHook.result.current.handleTouchEnd()
    })
    expect(touchHook.result.current.showScrollToBottom).toBe(true)
  })
})
