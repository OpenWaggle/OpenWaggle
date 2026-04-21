import type { RefObject } from 'react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64
const SCROLL_UP_HYSTERESIS_PX = 1
const SCROLLBAR_HIDE_DELAY_MS = 800
const SCROLL_PERSIST_DEBOUNCE_MS = 150
const THREAD_RESTORE_RETRY_MS = 96
const SCROLL_CACHE_MAX_ENTRIES = 100
const SCROLL_CACHE_KEY = 'openwaggle:scroll-positions'
const SCROLL_CACHE_ENTRY_LENGTH = 2

interface ScrollPosition {
  readonly scrollTop: number
  readonly clientHeight: number
  readonly scrollHeight: number
}

interface ScrollWheelEvent {
  readonly deltaY: number
}

interface ScrollTouchEvent {
  readonly touches: ArrayLike<{ readonly clientY: number }>
}

export interface UseChatScrollBehaviourParams {
  readonly activeConversationId: string | null
  readonly lastUserMessageId: string | null
  readonly rowsLength: number
  readonly streamVersion: number
  readonly isLoading: boolean
  readonly userDidSend: boolean
  readonly onUserDidSendConsumed: () => void
}

export interface UseChatScrollBehaviourResult {
  readonly scrollerRef: RefObject<HTMLDivElement | null>
  readonly contentRef: RefObject<HTMLDivElement | null>
  readonly showScrollbar: boolean
  readonly showScrollToBottom: boolean
  readonly scrollToBottom: () => void
  readonly handleScroll: () => void
  readonly handleWheel: (event: ScrollWheelEvent) => void
  readonly handlePointerDown: () => void
  readonly handlePointerUp: () => void
  readonly handlePointerCancel: () => void
  readonly handleTouchStart: (event: ScrollTouchEvent) => void
  readonly handleTouchMove: (event: ScrollTouchEvent) => void
  readonly handleTouchEnd: () => void
}

function isScrollCacheEntry(value: unknown): value is [string, number] {
  return (
    Array.isArray(value) &&
    value.length === SCROLL_CACHE_ENTRY_LENGTH &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  )
}

function loadScrollCache(): Map<string, number> {
  try {
    const raw = localStorage.getItem(SCROLL_CACHE_KEY)
    if (!raw) return new Map()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Map()
    const entries = parsed.filter(isScrollCacheEntry)
    return new Map(entries)
  } catch {
    return new Map()
  }
}

function saveScrollCache(cache: Map<string, number>): void {
  while (cache.size > SCROLL_CACHE_MAX_ENTRIES) {
    const firstKey: string | undefined = cache.keys().next().value
    if (firstKey === undefined) break
    cache.delete(firstKey)
  }
  try {
    localStorage.setItem(SCROLL_CACHE_KEY, JSON.stringify([...cache]))
  } catch {
    // Ignore storage errors.
  }
}

function isScrollContainerNearBottom(
  position: ScrollPosition,
  thresholdPx = AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
  const threshold = Number.isFinite(thresholdPx)
    ? Math.max(0, thresholdPx)
    : AUTO_SCROLL_BOTTOM_THRESHOLD_PX
  const { scrollTop, clientHeight, scrollHeight } = position
  if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite)) {
    return true
  }
  return scrollHeight - clientHeight - scrollTop <= threshold
}

function getMaxScrollTop(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight)
}

function scrollElementToBottom(el: HTMLElement, behavior: ScrollBehavior): void {
  if (typeof el.scrollTo === 'function') {
    el.scrollTo({ top: el.scrollHeight, behavior })
    return
  }
  el.scrollTop = el.scrollHeight
}

export function useChatScrollBehaviour(
  params: UseChatScrollBehaviourParams,
): UseChatScrollBehaviourResult {
  const {
    activeConversationId,
    rowsLength,
    streamVersion,
    isLoading,
    userDidSend,
    onUserDidSendConsumed,
  } = params
  const { lastUserMessageId } = params

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)

  const shouldAutoScrollRef = useRef(true)
  const lastKnownScrollTopRef = useRef(0)
  const isPointerScrollActiveRef = useRef(false)
  const lastTouchClientYRef = useRef<number | null>(null)
  const pendingUserScrollUpIntentRef = useRef(false)
  const pendingAutoScrollFrameRef = useRef<number | null>(null)
  const pendingRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRestoreScrollTopRef = useRef<number | null>(null)
  const lastRestoredConversationRef = useRef<string | null>(null)
  const hasRestoredScrollRef = useRef(false)
  const activeConversationIdRef = useRef(activeConversationId)
  const previousLastUserMessageIdRef = useRef(lastUserMessageId)
  const switchBaselineLastUserMessageIdRef = useRef<string | null>(null)
  const scrollCacheRef = useRef<Map<string, number>>(loadScrollCache())
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  activeConversationIdRef.current = activeConversationId

  const [showScrollbar, setShowScrollbar] = useState(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  const syncButtonVisibility = useCallback(() => {
    setShowScrollToBottom(!shouldAutoScrollRef.current)
  }, [])

  const saveScrollCacheSoon = useCallback(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      saveScrollCache(scrollCacheRef.current)
    }, SCROLL_PERSIST_DEBOUNCE_MS)
  }, [])

  const flushScrollCache = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    saveScrollCache(scrollCacheRef.current)
  }, [])

  const rememberScrollPosition = useCallback(
    (conversationId: string | null, scrollTop: number) => {
      if (!conversationId) return
      scrollCacheRef.current.delete(conversationId)
      scrollCacheRef.current.set(conversationId, Math.max(0, scrollTop))
      saveScrollCacheSoon()
    },
    [saveScrollCacheSoon],
  )

  const showScrollbarTemporarily = useCallback(() => {
    setShowScrollbar(true)
    if (scrollbarTimerRef.current) clearTimeout(scrollbarTimerRef.current)
    scrollbarTimerRef.current = setTimeout(() => {
      setShowScrollbar(false)
    }, SCROLLBAR_HIDE_DELAY_MS)
  }, [])

  const cancelPendingStickToBottom = useCallback(() => {
    const pendingFrame = pendingAutoScrollFrameRef.current
    if (pendingFrame === null) return
    pendingAutoScrollFrameRef.current = null
    window.cancelAnimationFrame(pendingFrame)
  }, [])

  const cancelPendingRestoreRetry = useCallback(() => {
    if (pendingRestoreTimerRef.current) {
      clearTimeout(pendingRestoreTimerRef.current)
      pendingRestoreTimerRef.current = null
    }
  }, [])

  const scrollMessagesToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const scrollContainer = scrollerRef.current
      if (!scrollContainer) return
      scrollElementToBottom(scrollContainer, behavior)
      lastKnownScrollTopRef.current = scrollContainer.scrollTop
      shouldAutoScrollRef.current = true
      pendingUserScrollUpIntentRef.current = false
      pendingRestoreScrollTopRef.current = null
      syncButtonVisibility()
      rememberScrollPosition(activeConversationIdRef.current, scrollContainer.scrollTop)
    },
    [rememberScrollPosition, syncButtonVisibility],
  )

  const scheduleStickToBottom = useCallback(() => {
    if (pendingAutoScrollFrameRef.current !== null) return
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null
      if (!shouldAutoScrollRef.current) return
      scrollMessagesToBottom()
    })
  }, [scrollMessagesToBottom])

  const applyPendingRestore = useCallback((): boolean => {
    const scrollContainer = scrollerRef.current
    const target = pendingRestoreScrollTopRef.current
    if (!scrollContainer || target === null) return false

    const maxScrollTop = getMaxScrollTop(scrollContainer)
    const nextScrollTop = Math.min(target, maxScrollTop)
    scrollContainer.scrollTop = nextScrollTop
    lastKnownScrollTopRef.current = nextScrollTop

    const fullyRestored = maxScrollTop >= target
    shouldAutoScrollRef.current = fullyRestored && isScrollContainerNearBottom(scrollContainer)
    syncButtonVisibility()

    if (!fullyRestored) {
      return true
    }

    pendingRestoreScrollTopRef.current = null
    rememberScrollPosition(activeConversationIdRef.current, nextScrollTop)
    return false
  }, [rememberScrollPosition, syncButtonVisibility])

  const scheduleRestoreRetry = useCallback(() => {
    if (pendingRestoreTimerRef.current !== null) return
    pendingRestoreTimerRef.current = setTimeout(() => {
      pendingRestoreTimerRef.current = null
      if (applyPendingRestore()) {
        scheduleRestoreRetry()
      }
    }, THREAD_RESTORE_RETRY_MS)
  }, [applyPendingRestore])

  const scrollToBottom = useCallback(() => {
    cancelPendingStickToBottom()
    cancelPendingRestoreRetry()
    scrollMessagesToBottom('smooth')
    scheduleStickToBottom()
  }, [
    cancelPendingRestoreRetry,
    cancelPendingStickToBottom,
    scheduleStickToBottom,
    scrollMessagesToBottom,
  ])

  const handleScroll = useCallback(() => {
    const scrollContainer = scrollerRef.current
    if (!scrollContainer) return

    showScrollbarTemporarily()

    const currentScrollTop = scrollContainer.scrollTop
    const isNearBottom = isScrollContainerNearBottom(scrollContainer)
    let shouldAutoScroll = shouldAutoScrollRef.current

    const disableAutoScroll = () => {
      shouldAutoScroll = false
      cancelPendingStickToBottom()
    }

    if (!shouldAutoScroll && isNearBottom) {
      shouldAutoScroll = true
      pendingUserScrollUpIntentRef.current = false
    }

    if (shouldAutoScroll && pendingUserScrollUpIntentRef.current) {
      const scrolledUp = currentScrollTop < lastKnownScrollTopRef.current - SCROLL_UP_HYSTERESIS_PX
      if (scrolledUp && !isNearBottom) {
        disableAutoScroll()
      }
      pendingUserScrollUpIntentRef.current = false
    }

    if (shouldAutoScroll && isPointerScrollActiveRef.current) {
      const scrolledUp = currentScrollTop < lastKnownScrollTopRef.current - SCROLL_UP_HYSTERESIS_PX
      if (scrolledUp && !isNearBottom) {
        disableAutoScroll()
      }
    }

    if (shouldAutoScroll && !isNearBottom) {
      const scrolledUp = currentScrollTop < lastKnownScrollTopRef.current - SCROLL_UP_HYSTERESIS_PX
      if (scrolledUp) {
        disableAutoScroll()
      }
    }

    shouldAutoScrollRef.current = shouldAutoScroll
    syncButtonVisibility()
    lastKnownScrollTopRef.current = currentScrollTop
    rememberScrollPosition(activeConversationIdRef.current, currentScrollTop)
  }, [
    cancelPendingStickToBottom,
    rememberScrollPosition,
    showScrollbarTemporarily,
    syncButtonVisibility,
  ])

  const optOutOfAutoScrollForUserIntent = useCallback(() => {
    const scrollContainer = scrollerRef.current
    pendingUserScrollUpIntentRef.current = true
    if (!scrollContainer || scrollContainer.scrollTop <= 0) return

    shouldAutoScrollRef.current = false
    cancelPendingStickToBottom()
    syncButtonVisibility()
  }, [cancelPendingStickToBottom, syncButtonVisibility])

  const handleWheel = useCallback(
    (event: ScrollWheelEvent) => {
      if (event.deltaY < 0) {
        optOutOfAutoScrollForUserIntent()
      }
    },
    [optOutOfAutoScrollForUserIntent],
  )

  const handlePointerDown = useCallback(() => {
    isPointerScrollActiveRef.current = true
  }, [])

  const handlePointerUp = useCallback(() => {
    isPointerScrollActiveRef.current = false
  }, [])

  const handlePointerCancel = useCallback(() => {
    isPointerScrollActiveRef.current = false
  }, [])

  const handleTouchStart = useCallback((event: ScrollTouchEvent) => {
    const touch = event.touches[0]
    if (!touch) return
    lastTouchClientYRef.current = touch.clientY
  }, [])

  const handleTouchMove = useCallback(
    (event: ScrollTouchEvent) => {
      const touch = event.touches[0]
      if (!touch) return
      const previousTouchY = lastTouchClientYRef.current
      if (previousTouchY !== null && touch.clientY > previousTouchY + SCROLL_UP_HYSTERESIS_PX) {
        optOutOfAutoScrollForUserIntent()
      }
      lastTouchClientYRef.current = touch.clientY
    },
    [optOutOfAutoScrollForUserIntent],
  )

  const handleTouchEnd = useCallback(() => {
    lastTouchClientYRef.current = null
  }, [])

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (pendingRestoreScrollTopRef.current !== null) {
        if (applyPendingRestore()) {
          scheduleRestoreRetry()
        }
        return
      }
      if (!shouldAutoScrollRef.current) return
      scheduleStickToBottom()
    })

    observer.observe(content)
    return () => observer.disconnect()
  }, [applyPendingRestore, scheduleRestoreRetry, scheduleStickToBottom])

  useLayoutEffect(() => {
    const previous = lastRestoredConversationRef.current
    if (previous && previous !== activeConversationId) {
      flushScrollCache()
      switchBaselineLastUserMessageIdRef.current = previousLastUserMessageIdRef.current
    }

    hasRestoredScrollRef.current = false
    lastRestoredConversationRef.current = activeConversationId
    pendingRestoreScrollTopRef.current = null
    pendingUserScrollUpIntentRef.current = false
    shouldAutoScrollRef.current = true
    lastTouchClientYRef.current = null
    isPointerScrollActiveRef.current = false
    cancelPendingStickToBottom()
    cancelPendingRestoreRetry()
    syncButtonVisibility()
  }, [
    activeConversationId,
    cancelPendingRestoreRetry,
    cancelPendingStickToBottom,
    flushScrollCache,
    syncButtonVisibility,
  ])

  useLayoutEffect(() => {
    if (hasRestoredScrollRef.current) return
    if (!activeConversationId) return
    if (rowsLength === 0) return
    if (userDidSend) return
    const switchBaselineLastUserMessageId = switchBaselineLastUserMessageIdRef.current
    if (
      switchBaselineLastUserMessageId !== null &&
      lastUserMessageId === switchBaselineLastUserMessageId
    ) {
      return
    }
    switchBaselineLastUserMessageIdRef.current = null

    const scrollContainer = scrollerRef.current
    if (!scrollContainer) return

    const persisted = scrollCacheRef.current.get(activeConversationId)
    if (persisted !== undefined && persisted > 0) {
      pendingRestoreScrollTopRef.current = persisted
      if (applyPendingRestore()) {
        scheduleRestoreRetry()
      }
    } else {
      scrollMessagesToBottom()
    }

    hasRestoredScrollRef.current = true
  }, [
    activeConversationId,
    applyPendingRestore,
    lastUserMessageId,
    rowsLength,
    scheduleRestoreRetry,
    scrollMessagesToBottom,
    userDidSend,
  ])

  useLayoutEffect(() => {
    previousLastUserMessageIdRef.current = lastUserMessageId
  }, [lastUserMessageId])

  useLayoutEffect(() => {
    if (!userDidSend) return
    if (!isLoading) return
    if (rowsLength === 0) return
    if (!scrollerRef.current) return

    cancelPendingRestoreRetry()
    pendingRestoreScrollTopRef.current = null
    shouldAutoScrollRef.current = true
    pendingUserScrollUpIntentRef.current = false
    hasRestoredScrollRef.current = true
    scrollMessagesToBottom()
    scheduleStickToBottom()
    onUserDidSendConsumed()
  }, [
    cancelPendingRestoreRetry,
    isLoading,
    onUserDidSendConsumed,
    rowsLength,
    scheduleStickToBottom,
    scrollMessagesToBottom,
    userDidSend,
  ])

  useLayoutEffect(() => {
    const hasContentSignal = rowsLength > 0 || streamVersion > 0
    if (!isLoading && !hasContentSignal) return
    if (!shouldAutoScrollRef.current) return
    scheduleStickToBottom()
  }, [isLoading, rowsLength, scheduleStickToBottom, streamVersion])

  useLayoutEffect(() => {
    return () => {
      cancelPendingStickToBottom()
      cancelPendingRestoreRetry()
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      if (scrollbarTimerRef.current) clearTimeout(scrollbarTimerRef.current)

      const conversationId = lastRestoredConversationRef.current
      const scroller = scrollerRef.current
      if (conversationId && scroller) {
        scrollCacheRef.current.delete(conversationId)
        scrollCacheRef.current.set(conversationId, Math.max(0, scroller.scrollTop))
      }
      saveScrollCache(scrollCacheRef.current)
    }
  }, [cancelPendingRestoreRetry, cancelPendingStickToBottom])

  return {
    scrollerRef,
    contentRef,
    showScrollbar,
    showScrollToBottom,
    scrollToBottom,
    handleScroll,
    handleWheel,
    handlePointerDown,
    handlePointerUp,
    handlePointerCancel,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  }
}
