import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatScrollBehaviour } from '../hooks/useChatScrollBehaviour'

const REQUEST_ANIMATION_FRAME_DELAY_MS = 16
const SCROLL_POSITIONS_STORAGE_KEY = 'openwaggle:chat-scroll-positions:v1'

function createDefaultParams(
  overrides: Partial<Parameters<typeof useChatScrollBehaviour>[0]> = {},
) {
  return {
    lastUserMessageId: null,
    messagesLength: 0,
    rowsLength: 0,
    isLoading: false,
    disableAutoFollowDuringWaggleStreaming: false,
    activeConversationId: 'conv-1',
    ...overrides,
  }
}

function attachRefs(
  hookResult: ReturnType<typeof useChatScrollBehaviour>,
  elements: {
    scroller: HTMLDivElement
    spacer?: HTMLDivElement | null
    userMessage?: HTMLDivElement | null
  },
): void {
  Object.defineProperty(hookResult.scrollerRef, 'current', {
    value: elements.scroller,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(hookResult.spacerRef, 'current', {
    value: elements.spacer ?? null,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(hookResult.userMessageRef, 'current', {
    value: elements.userMessage ?? null,
    writable: true,
    configurable: true,
  })
}

function createScroller({
  scrollHeight = 1000,
  clientHeight = 500,
  scrollTop = 0,
}: {
  scrollHeight?: number
  clientHeight?: number
  scrollTop?: number
} = {}): HTMLDivElement {
  const scroller = document.createElement('div')
  Object.defineProperty(scroller, 'scrollHeight', {
    value: scrollHeight,
    configurable: true,
  })
  Object.defineProperty(scroller, 'clientHeight', {
    value: clientHeight,
    configurable: true,
  })
  scroller.scrollTop = scrollTop
  Object.defineProperty(scroller, 'scrollTo', {
    value: vi.fn((options?: ScrollToOptions) => {
      const top = typeof options?.top === 'number' ? options.top : 0
      scroller.scrollTop = top
    }),
    configurable: true,
  })
  return scroller
}

function createUserMessageElement(offsetTop: number): HTMLDivElement {
  const userMessage = document.createElement('div')
  Object.defineProperty(userMessage, 'offsetTop', {
    value: offsetTop,
    configurable: true,
  })
  return userMessage
}

describe('useChatScrollBehaviour', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), REQUEST_ANIMATION_FRAME_DELAY_MS),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
      window.clearTimeout(handle)
    })
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
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
    const div = createScroller({ scrollHeight: 500, clientHeight: 200, scrollTop: 0 })

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, { scroller: div })
        return hookResult
      },
      { initialProps: createDefaultParams({ rowsLength: 0 }) },
    )

    attachRefs(result.current, { scroller: div })

    rerender(createDefaultParams({ rowsLength: 5 }))

    expect(div.scrollTop).toBe(500)
  })

  it('does not scroll to bottom on initial load when waggle anchor mode is active', () => {
    const div = document.createElement('div')
    Object.defineProperty(div, 'scrollHeight', { value: 500, configurable: true })
    div.scrollTop = 0

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, { scroller: div })
        return hookResult
      },
      {
        initialProps: createDefaultParams({
          rowsLength: 0,
          disableAutoFollowDuringWaggleStreaming: true,
        }),
      },
    )

    attachRefs(result.current, { scroller: div })

    rerender(
      createDefaultParams({
        rowsLength: 5,
        disableAutoFollowDuringWaggleStreaming: true,
      }),
    )

    expect(div.scrollTop).toBe(0)
  })

  it('auto-scrolls when isLoading and rows grow and near bottom', () => {
    const div = createScroller({
      scrollHeight: 1000,
      clientHeight: 500,
      scrollTop: 480, // distanceFromBottom = 1000 - 480 - 500 = 20 < 50
    })

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, { scroller: div })
        return hookResult
      },
      { initialProps: createDefaultParams({ isLoading: true, rowsLength: 5 }) },
    )

    attachRefs(result.current, { scroller: div })

    rerender(createDefaultParams({ isLoading: true, rowsLength: 6 }))

    expect(div.scrollTop).toBe(1000)
  })

  it('does NOT auto-scroll when distanceFromBottom > 50', () => {
    const div = createScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, { scroller: div })
        return hookResult
      },
      { initialProps: createDefaultParams({ isLoading: true, rowsLength: 5 }) },
    )

    attachRefs(result.current, { scroller: div })

    // After initial load scroll-to-bottom fires (scrollTop = 1000),
    // simulate user scrolling up so distanceFromBottom > 50.
    div.scrollTop = 100

    rerender(createDefaultParams({ isLoading: true, rowsLength: 6 }))

    expect(div.scrollTop).toBe(100)
  })

  it('does not auto-scroll when waggle anchor mode is active', () => {
    const div = createScroller({
      scrollHeight: 1000,
      clientHeight: 500,
      scrollTop: 480, // distanceFromBottom = 20 < 50
    })

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, { scroller: div })
        return hookResult
      },
      {
        initialProps: createDefaultParams({
          isLoading: true,
          rowsLength: 5,
          disableAutoFollowDuringWaggleStreaming: true,
        }),
      },
    )

    attachRefs(result.current, { scroller: div })
    // Simulate user position after the initial load effect scrolls to bottom.
    div.scrollTop = 480

    rerender(
      createDefaultParams({
        isLoading: true,
        rowsLength: 6,
        disableAutoFollowDuringWaggleStreaming: true,
      }),
    )

    expect(div.scrollTop).toBe(480)
  })

  it('does not trigger send-anchor scroll when switching conversations', async () => {
    const scroller = createScroller({ scrollHeight: 1200, clientHeight: 500, scrollTop: 200 })
    const userMessage = createUserMessageElement(260)

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, {
          scroller,
          userMessage,
        })
        return hookResult
      },
      {
        initialProps: createDefaultParams({
          activeConversationId: 'conv-a',
          lastUserMessageId: null,
          messagesLength: 0,
          rowsLength: 0,
        }),
      },
    )

    attachRefs(result.current, { scroller, userMessage })

    rerender(
      createDefaultParams({
        activeConversationId: 'conv-b',
        lastUserMessageId: 'user-b-1',
        messagesLength: 2,
        rowsLength: 2,
      }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    expect(scroller.scrollTo).not.toHaveBeenCalled()
  })

  it('does not trigger send-anchor when last user message arrives after conversation switch', async () => {
    const scroller = createScroller({ scrollHeight: 1200, clientHeight: 500, scrollTop: 260 })
    const userMessage = createUserMessageElement(300)

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, {
          scroller,
          userMessage,
        })
        return hookResult
      },
      {
        initialProps: createDefaultParams({
          activeConversationId: 'conv-a',
          lastUserMessageId: 'user-a-1',
          messagesLength: 2,
          rowsLength: 2,
        }),
      },
    )

    attachRefs(result.current, { scroller, userMessage })

    rerender(
      createDefaultParams({
        activeConversationId: 'conv-b',
        lastUserMessageId: null,
        messagesLength: 0,
        rowsLength: 0,
      }),
    )

    rerender(
      createDefaultParams({
        activeConversationId: 'conv-b',
        lastUserMessageId: 'user-b-1',
        messagesLength: 2,
        rowsLength: 2,
      }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    expect(scroller.scrollTo).not.toHaveBeenCalled()
  })

  it('does not trigger send-anchor when user message id flips during thread hydration', async () => {
    const scroller = createScroller({ scrollHeight: 2000, clientHeight: 500, scrollTop: 320 })
    const userMessage = createUserMessageElement(360)

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, {
          scroller,
          userMessage,
        })
        return hookResult
      },
      {
        initialProps: createDefaultParams({
          activeConversationId: 'conv-a',
          lastUserMessageId: 'user-a-1',
          messagesLength: 4,
          rowsLength: 4,
        }),
      },
    )

    attachRefs(result.current, { scroller, userMessage })

    // Switch to thread B while props are still carrying thread A's last user id.
    rerender(
      createDefaultParams({
        activeConversationId: 'conv-b',
        lastUserMessageId: 'user-a-1',
        messagesLength: 5,
        rowsLength: 5,
      }),
    )

    // Hydration updates thread B to its actual last user id on a later render.
    rerender(
      createDefaultParams({
        activeConversationId: 'conv-b',
        lastUserMessageId: 'user-b-1',
        messagesLength: 7,
        rowsLength: 7,
      }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
      await vi.advanceTimersByTimeAsync(120)
    })

    expect(scroller.scrollTo).not.toHaveBeenCalled()
  })

  it('still anchors when a real user send happens during navigation suppression', async () => {
    const scroller = createScroller({ scrollHeight: 2000, clientHeight: 500, scrollTop: 220 })
    const userMessage = createUserMessageElement(360)

    localStorage.setItem(
      SCROLL_POSITIONS_STORAGE_KEY,
      JSON.stringify({
        'conv-b': {
          scrollTop: 220,
          lastSeenUserMessageId: 'user-b-1',
          updatedAt: Date.now(),
        },
      }),
    )

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, {
          scroller,
          userMessage,
        })
        return hookResult
      },
      {
        initialProps: createDefaultParams({
          activeConversationId: 'conv-a',
          lastUserMessageId: 'user-a-1',
          messagesLength: 2,
          rowsLength: 2,
          isLoading: false,
        }),
      },
    )

    attachRefs(result.current, { scroller, userMessage })

    rerender(
      createDefaultParams({
        activeConversationId: 'conv-b',
        lastUserMessageId: 'user-b-1',
        messagesLength: 2,
        rowsLength: 2,
        isLoading: false,
      }),
    )

    rerender(
      createDefaultParams({
        activeConversationId: 'conv-b',
        lastUserMessageId: 'user-b-2',
        messagesLength: 3,
        rowsLength: 3,
        isLoading: true,
      }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: 340,
      behavior: 'smooth',
    })
  })

  it('saves outgoing thread scroll and restores it when returning', async () => {
    const scroller = createScroller({ scrollHeight: 2000, clientHeight: 500, scrollTop: 0 })

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, { scroller })
        return hookResult
      },
      {
        initialProps: createDefaultParams({
          activeConversationId: 'conv-a',
          lastUserMessageId: 'user-a-1',
          messagesLength: 2,
          rowsLength: 2,
        }),
      },
    )

    attachRefs(result.current, { scroller })
    scroller.scrollTop = 320
    act(() => {
      result.current.handleScroll()
    })

    rerender(
      createDefaultParams({
        activeConversationId: 'conv-b',
        lastUserMessageId: 'user-b-1',
        messagesLength: 2,
        rowsLength: 2,
      }),
    )

    scroller.scrollTop = 700

    rerender(
      createDefaultParams({
        activeConversationId: 'conv-a',
        lastUserMessageId: 'user-a-1',
        messagesLength: 2,
        rowsLength: 2,
      }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    expect(scroller.scrollTop).toBe(320)
  })

  it('persists and rehydrates scroll positions from localStorage', async () => {
    const firstScroller = createScroller({ scrollHeight: 2000, clientHeight: 500, scrollTop: 0 })

    const first = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, {
          scroller: firstScroller,
        })
        return hookResult
      },
      {
        initialProps: createDefaultParams({
          activeConversationId: 'conv-persisted',
          lastUserMessageId: 'persisted-user-1',
          messagesLength: 2,
          rowsLength: 2,
        }),
      },
    )

    attachRefs(first.result.current, { scroller: firstScroller })
    firstScroller.scrollTop = 410
    act(() => {
      first.result.current.handleScroll()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    first.unmount()

    const persistedRaw = localStorage.getItem(SCROLL_POSITIONS_STORAGE_KEY)
    expect(persistedRaw).not.toBeNull()
    const persisted = JSON.parse(persistedRaw ?? '{}') as Record<
      string,
      { scrollTop: number; lastSeenUserMessageId: string | null; updatedAt: number }
    >
    expect(persisted['conv-persisted']?.scrollTop).toBe(410)
    expect(persisted['conv-persisted']?.lastSeenUserMessageId).toBe('persisted-user-1')

    const secondScroller = createScroller({ scrollHeight: 2000, clientHeight: 500, scrollTop: 0 })
    const second = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, {
          scroller: secondScroller,
        })
        return hookResult
      },
      {
        initialProps: createDefaultParams({
          activeConversationId: 'conv-persisted',
          lastUserMessageId: 'persisted-user-1',
          messagesLength: 2,
          rowsLength: 2,
        }),
      },
    )

    attachRefs(second.result.current, { scroller: secondScroller })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    expect(secondScroller.scrollTop).toBe(410)
  })

  it('anchors to top when a genuinely new user message appears in the active thread', async () => {
    const scroller = createScroller({ scrollHeight: 1600, clientHeight: 500, scrollTop: 0 })
    const userMessage = createUserMessageElement(300)

    localStorage.setItem(
      SCROLL_POSITIONS_STORAGE_KEY,
      JSON.stringify({
        'conv-anchor': {
          scrollTop: 200,
          lastSeenUserMessageId: 'user-old',
          updatedAt: Date.now(),
        },
      }),
    )

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, {
          scroller,
          userMessage,
        })
        return hookResult
      },
      {
        initialProps: createDefaultParams({
          activeConversationId: 'conv-anchor',
          lastUserMessageId: 'user-old',
          messagesLength: 2,
          rowsLength: 2,
        }),
      },
    )

    attachRefs(result.current, { scroller, userMessage })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    rerender(
      createDefaultParams({
        activeConversationId: 'conv-anchor',
        lastUserMessageId: 'user-new',
        messagesLength: 3,
        rowsLength: 3,
      }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: 280,
      behavior: 'smooth',
    })
  })

  it('resets spacer height when activeConversationId changes', () => {
    const spacerDiv = document.createElement('div')
    spacerDiv.style.height = '200px'

    const { result, rerender } = renderHook(
      (props) => {
        const hookResult = useChatScrollBehaviour(props)
        attachRefs(hookResult, {
          scroller: createScroller(),
          spacer: spacerDiv,
        })
        return hookResult
      },
      { initialProps: createDefaultParams({ activeConversationId: 'conv-1' }) },
    )

    attachRefs(result.current, {
      scroller: createScroller(),
      spacer: spacerDiv,
    })

    rerender(createDefaultParams({ activeConversationId: 'conv-2' }))

    expect(spacerDiv.style.height).toBe('0px')
  })
})
