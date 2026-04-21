// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import type { RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type UseChatScrollBehaviourParams,
  type UseChatScrollBehaviourResult,
  useChatScrollBehaviour,
} from '../hooks/useChatScrollBehaviour'

const SCROLL_CACHE_KEY = 'openwaggle:scroll-positions'
const ANIMATION_FRAME_DELAY_MS = 16
const SCROLL_PERSIST_DEBOUNCE_MS = 150

function createDefaultParams(
  overrides: Partial<UseChatScrollBehaviourParams> = {},
): UseChatScrollBehaviourParams {
  return {
    activeConversationId: 'conv-1',
    lastUserMessageId: 'user-1',
    rowsLength: 5,
    streamVersion: 5,
    isLoading: false,
    userDidSend: false,
    onUserDidSendConsumed: vi.fn(),
    ...overrides,
  }
}

function setRef<T>(ref: RefObject<T | null>, value: T): void {
  Object.defineProperty(ref, 'current', {
    value,
    writable: true,
    configurable: true,
  })
}

interface TestLayout {
  readonly scroller: HTMLDivElement
  readonly content: HTMLDivElement
  readonly scrollToMock: ReturnType<typeof vi.fn>
  getScrollTop: () => number
  setNaturalScrollHeight: (height: number) => void
  setScrollTop: (scrollTop: number) => void
}

function createTestLayout({
  naturalScrollHeight = 1000,
  clientHeight = 500,
  scrollTop = 0,
}: {
  readonly naturalScrollHeight?: number
  readonly clientHeight?: number
  readonly scrollTop?: number
} = {}): TestLayout {
  const scroller = document.createElement('div')
  const content = document.createElement('div')
  let currentNaturalScrollHeight = naturalScrollHeight
  let currentScrollTop = scrollTop

  function getMaxScrollTop(): number {
    return Math.max(0, currentNaturalScrollHeight - clientHeight)
  }

  function setClampedScrollTop(value: number): void {
    currentScrollTop = Math.min(Math.max(0, value), getMaxScrollTop())
  }

  Object.defineProperty(scroller, 'scrollHeight', {
    get: () => currentNaturalScrollHeight,
    configurable: true,
  })
  Object.defineProperty(scroller, 'clientHeight', {
    get: () => clientHeight,
    configurable: true,
  })
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => currentScrollTop,
    set: setClampedScrollTop,
    configurable: true,
  })

  const scrollToMock = vi.fn((options?: ScrollToOptions | number, y?: number) => {
    if (typeof options === 'number') {
      setClampedScrollTop(y ?? 0)
      return
    }
    setClampedScrollTop(options?.top ?? 0)
  })
  Object.defineProperty(scroller, 'scrollTo', {
    value: scrollToMock,
    configurable: true,
  })

  return {
    scroller,
    content,
    scrollToMock,
    getScrollTop: () => currentScrollTop,
    setNaturalScrollHeight: (height) => {
      currentNaturalScrollHeight = height
    },
    setScrollTop: setClampedScrollTop,
  }
}

function attachRefs(hook: UseChatScrollBehaviourResult, layout: TestLayout): void {
  setRef(hook.scrollerRef, layout.scroller)
  setRef(hook.contentRef, layout.content)
}

function renderScrollHook(params: UseChatScrollBehaviourParams, layout: TestLayout) {
  return renderHook(
    (props: UseChatScrollBehaviourParams) => {
      const hook = useChatScrollBehaviour(props)
      attachRefs(hook, layout)
      return hook
    },
    { initialProps: params },
  )
}

function expectScrollCacheEntry(conversationId: string, scrollTop: number): void {
  const raw = localStorage.getItem(SCROLL_CACHE_KEY)
  expect(raw).not.toBeNull()
  const parsed: unknown = JSON.parse(raw ?? '[]')
  expect(Array.isArray(parsed)).toBe(true)
  expect(parsed).toContainEqual([conversationId, scrollTop])
}

function flushAnimationFrame(): void {
  act(() => {
    vi.advanceTimersByTime(ANIMATION_FRAME_DELAY_MS)
  })
}

describe('useChatScrollBehaviour', () => {
  let triggerResize: (() => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    triggerResize = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), ANIMATION_FRAME_DELAY_MS),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
      window.clearTimeout(handle)
    })

    class TestResizeObserver {
      private readonly runCallback: () => void

      constructor(callback: ResizeObserverCallback) {
        this.runCallback = () => callback([], this)
        triggerResize = this.runCallback
      }

      observe(): void {}

      unobserve(): void {}

      disconnect(): void {}
    }

    vi.stubGlobal('ResizeObserver', TestResizeObserver)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    localStorage.clear()
  })

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
    const layout = createTestLayout({
      naturalScrollHeight: 1000,
      clientHeight: 500,
    })
    renderScrollHook(createDefaultParams(), layout)

    expect(layout.getScrollTop()).toBe(500)

    layout.setNaturalScrollHeight(1200)
    act(() => {
      triggerResize?.()
    })
    flushAnimationFrame()

    expect(layout.getScrollTop()).toBe(700)
  })

  it('follows streaming content updates even when row count does not change', () => {
    const layout = createTestLayout({
      naturalScrollHeight: 1000,
      clientHeight: 500,
    })
    const { rerender } = renderScrollHook(
      createDefaultParams({ isLoading: true, rowsLength: 2, streamVersion: 10 }),
      layout,
    )

    expect(layout.getScrollTop()).toBe(500)

    layout.setNaturalScrollHeight(1200)
    rerender(createDefaultParams({ isLoading: true, rowsLength: 2, streamVersion: 11 }))
    flushAnimationFrame()

    expect(layout.getScrollTop()).toBe(700)
  })

  it('cancels a queued stream follow immediately when the user wheels upward', () => {
    const layout = createTestLayout({
      naturalScrollHeight: 1000,
      clientHeight: 500,
    })
    const { result, rerender } = renderScrollHook(
      createDefaultParams({ isLoading: true, rowsLength: 2, streamVersion: 10 }),
      layout,
    )

    expect(layout.getScrollTop()).toBe(500)

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
    const layout = createTestLayout({
      naturalScrollHeight: 1000,
      clientHeight: 500,
    })
    const { result, rerender } = renderScrollHook(
      createDefaultParams({ isLoading: true, rowsLength: 2, streamVersion: 10 }),
      layout,
    )

    expect(layout.getScrollTop()).toBe(500)

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
    const layout = createTestLayout({
      naturalScrollHeight: 1000,
      clientHeight: 500,
    })
    const { result } = renderScrollHook(createDefaultParams(), layout)

    layout.setScrollTop(300)
    act(() => {
      result.current.handleWheel({ deltaY: -120 })
      result.current.handleScroll()
    })

    expect(result.current.showScrollToBottom).toBe(true)

    layout.setNaturalScrollHeight(1300)
    act(() => {
      triggerResize?.()
    })
    flushAnimationFrame()

    expect(layout.getScrollTop()).toBe(300)
  })

  it('does not follow streaming content updates after the user opts out', () => {
    const layout = createTestLayout({
      naturalScrollHeight: 1000,
      clientHeight: 500,
    })
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
    const layout = createTestLayout({
      naturalScrollHeight: 1000,
      clientHeight: 500,
    })
    const { result } = renderScrollHook(createDefaultParams(), layout)

    layout.setScrollTop(300)
    act(() => {
      result.current.handleWheel({ deltaY: -120 })
      result.current.handleScroll()
    })
    expect(result.current.showScrollToBottom).toBe(true)

    layout.setScrollTop(500)
    act(() => {
      result.current.handleScroll()
    })
    expect(result.current.showScrollToBottom).toBe(false)

    layout.setNaturalScrollHeight(1300)
    act(() => {
      triggerResize?.()
    })
    flushAnimationFrame()

    expect(layout.getScrollTop()).toBe(800)
  })

  it('opts out for pointer scrollbar drags and touch upward gestures', () => {
    const pointerLayout = createTestLayout({
      naturalScrollHeight: 1000,
      clientHeight: 500,
    })
    const pointerHook = renderScrollHook(createDefaultParams(), pointerLayout)

    pointerLayout.setScrollTop(250)
    act(() => {
      pointerHook.result.current.handlePointerDown()
      pointerHook.result.current.handleScroll()
      pointerHook.result.current.handlePointerUp()
    })
    expect(pointerHook.result.current.showScrollToBottom).toBe(true)

    const touchLayout = createTestLayout({
      naturalScrollHeight: 1000,
      clientHeight: 500,
    })
    const touchHook = renderScrollHook(
      createDefaultParams({ activeConversationId: 'conv-touch' }),
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

  it('scrollToBottom re-enables follow mode with smooth scrolling', () => {
    const layout = createTestLayout({
      naturalScrollHeight: 1000,
      clientHeight: 500,
    })
    const { result } = renderScrollHook(createDefaultParams(), layout)

    layout.setScrollTop(300)
    act(() => {
      result.current.handleWheel({ deltaY: -120 })
      result.current.handleScroll()
    })
    expect(result.current.showScrollToBottom).toBe(true)

    act(() => {
      result.current.scrollToBottom()
    })

    expect(layout.getScrollTop()).toBe(500)
    expect(result.current.showScrollToBottom).toBe(false)
    expect(layout.scrollToMock).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' })
  })

  it('restores the scroll position captured from the previous thread scroll event', () => {
    const layout = createTestLayout({
      naturalScrollHeight: 2000,
      clientHeight: 500,
    })
    const { result, rerender } = renderScrollHook(
      createDefaultParams({ activeConversationId: 'conv-a', lastUserMessageId: 'user-a' }),
      layout,
    )

    layout.setScrollTop(320)
    act(() => {
      result.current.handleScroll()
    })

    layout.setScrollTop(900)
    rerender(createDefaultParams({ activeConversationId: 'conv-b', lastUserMessageId: 'user-b' }))
    act(() => {
      result.current.handleScroll()
    })

    rerender(createDefaultParams({ activeConversationId: 'conv-a', lastUserMessageId: 'user-a' }))

    expect(layout.getScrollTop()).toBe(320)
  })

  it('keeps a restore pending until hydrated content is tall enough for the saved offset', () => {
    const layout = createTestLayout({
      naturalScrollHeight: 2000,
      clientHeight: 500,
    })
    const { result, rerender } = renderScrollHook(
      createDefaultParams({ activeConversationId: 'conv-a', lastUserMessageId: 'user-a' }),
      layout,
    )

    layout.setScrollTop(640)
    act(() => {
      result.current.handleScroll()
    })

    rerender(createDefaultParams({ activeConversationId: 'conv-b', lastUserMessageId: 'user-b' }))
    layout.setNaturalScrollHeight(100)
    rerender(createDefaultParams({ activeConversationId: 'conv-a', lastUserMessageId: 'user-a' }))

    expect(layout.getScrollTop()).toBe(0)

    layout.setNaturalScrollHeight(1200)
    act(() => {
      triggerResize?.()
    })

    expect(layout.getScrollTop()).toBe(640)
  })

  it('waits for the incoming thread user id before restoring same-length hydrated rows', () => {
    const layout = createTestLayout({
      naturalScrollHeight: 2000,
      clientHeight: 500,
    })
    const { result, rerender } = renderScrollHook(
      createDefaultParams({
        activeConversationId: 'conv-a',
        lastUserMessageId: 'user-a',
      }),
      layout,
    )

    layout.setScrollTop(640)
    act(() => {
      result.current.handleScroll()
    })

    rerender(
      createDefaultParams({
        activeConversationId: 'conv-b',
        lastUserMessageId: 'user-a',
      }),
    )
    expect(layout.getScrollTop()).toBe(640)

    layout.setNaturalScrollHeight(500)
    rerender(
      createDefaultParams({
        activeConversationId: 'conv-b',
        lastUserMessageId: 'user-b',
      }),
    )
    expect(layout.getScrollTop()).toBe(0)

    rerender(
      createDefaultParams({
        activeConversationId: 'conv-a',
        lastUserMessageId: 'user-b',
      }),
    )
    expect(layout.getScrollTop()).toBe(0)

    layout.setNaturalScrollHeight(2000)
    rerender(
      createDefaultParams({
        activeConversationId: 'conv-a',
        lastUserMessageId: 'user-a',
      }),
    )
    expect(layout.getScrollTop()).toBe(640)
  })

  it('does not misattribute a debounced scroll write after a fast thread switch', () => {
    const layout = createTestLayout({
      naturalScrollHeight: 2000,
      clientHeight: 500,
    })
    const { result, rerender } = renderScrollHook(
      createDefaultParams({ activeConversationId: 'conv-a', lastUserMessageId: 'user-a' }),
      layout,
    )

    layout.setScrollTop(320)
    act(() => {
      result.current.handleScroll()
    })

    layout.setScrollTop(900)
    rerender(createDefaultParams({ activeConversationId: 'conv-b', lastUserMessageId: 'user-b' }))

    act(() => {
      vi.advanceTimersByTime(SCROLL_PERSIST_DEBOUNCE_MS)
    })

    expectScrollCacheEntry('conv-a', 320)
  })

  it('showScrollbar starts false and becomes true on scroll then hides', () => {
    const layout = createTestLayout()
    const { result } = renderScrollHook(createDefaultParams(), layout)

    expect(result.current.showScrollbar).toBe(false)

    act(() => {
      result.current.handleScroll()
    })
    expect(result.current.showScrollbar).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.showScrollbar).toBe(false)
  })
})
