// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultParams,
  createTestLayout,
  expectScrollCacheEntry,
  installChatScrollTestEnvironment,
  renderScrollHook,
  SCROLL_PERSIST_DEBOUNCE_MS,
  triggerObservedResize,
} from './useChatScrollBehaviour.test-utils'

describe('useChatScrollBehaviour session restoration behavior', () => {
  installChatScrollTestEnvironment()

  it('restores the scroll position captured from the previous session scroll event', () => {
    const layout = createTestLayout({ naturalScrollHeight: 2000, clientHeight: 500 })
    const { result, rerender } = renderScrollHook(
      createDefaultParams({ activeSessionId: 'session-a', lastUserMessageId: 'user-a' }),
      layout,
    )

    layout.setScrollTop(320)
    act(() => {
      result.current.handleScroll()
    })

    layout.setScrollTop(900)
    rerender(createDefaultParams({ activeSessionId: 'session-b', lastUserMessageId: 'user-b' }))
    act(() => {
      result.current.handleScroll()
    })

    rerender(createDefaultParams({ activeSessionId: 'session-a', lastUserMessageId: 'user-a' }))

    expect(layout.getScrollTop()).toBe(320)
  })

  it('keeps a restore pending until hydrated content is tall enough for the saved offset', () => {
    const layout = createTestLayout({ naturalScrollHeight: 2000, clientHeight: 500 })
    const { result, rerender } = renderScrollHook(
      createDefaultParams({ activeSessionId: 'session-a', lastUserMessageId: 'user-a' }),
      layout,
    )

    layout.setScrollTop(640)
    act(() => {
      result.current.handleScroll()
    })

    rerender(createDefaultParams({ activeSessionId: 'session-b', lastUserMessageId: 'user-b' }))
    layout.setNaturalScrollHeight(100)
    rerender(createDefaultParams({ activeSessionId: 'session-a', lastUserMessageId: 'user-a' }))

    expect(layout.getScrollTop()).toBe(0)

    layout.setNaturalScrollHeight(1200)
    triggerObservedResize()

    expect(layout.getScrollTop()).toBe(640)
  })

  it('waits for the incoming session user id before restoring same-length hydrated rows', () => {
    const layout = createTestLayout({ naturalScrollHeight: 2000, clientHeight: 500 })
    const { result, rerender } = renderScrollHook(
      createDefaultParams({ activeSessionId: 'session-a', lastUserMessageId: 'user-a' }),
      layout,
    )

    layout.setScrollTop(640)
    act(() => {
      result.current.handleScroll()
    })

    rerender(createDefaultParams({ activeSessionId: 'session-b', lastUserMessageId: 'user-a' }))
    expect(layout.getScrollTop()).toBe(640)

    layout.setNaturalScrollHeight(500)
    rerender(createDefaultParams({ activeSessionId: 'session-b', lastUserMessageId: 'user-b' }))
    expect(layout.getScrollTop()).toBe(0)

    rerender(createDefaultParams({ activeSessionId: 'session-a', lastUserMessageId: 'user-b' }))
    expect(layout.getScrollTop()).toBe(0)

    layout.setNaturalScrollHeight(2000)
    rerender(createDefaultParams({ activeSessionId: 'session-a', lastUserMessageId: 'user-a' }))
    expect(layout.getScrollTop()).toBe(640)
  })

  it('does not misattribute a debounced scroll write after a fast session switch', () => {
    const layout = createTestLayout({ naturalScrollHeight: 2000, clientHeight: 500 })
    const { result, rerender } = renderScrollHook(
      createDefaultParams({ activeSessionId: 'session-a', lastUserMessageId: 'user-a' }),
      layout,
    )

    layout.setScrollTop(320)
    act(() => {
      result.current.handleScroll()
    })

    layout.setScrollTop(900)
    rerender(createDefaultParams({ activeSessionId: 'session-b', lastUserMessageId: 'user-b' }))

    act(() => {
      vi.advanceTimersByTime(SCROLL_PERSIST_DEBOUNCE_MS)
    })

    expectScrollCacheEntry('session-a', 320)
  })
})
