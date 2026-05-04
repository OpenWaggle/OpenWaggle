import type { RefObject } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import {
  getMaxScrollTop,
  isScrollContainerNearBottom,
  scrollElementToBottom,
} from '@/lib/scroll-to-bottom'

const SCROLL_UP_HYSTERESIS_PX = 1
const SCROLLBAR_HIDE_DELAY_MS = 800
const SCROLL_PERSIST_DEBOUNCE_MS = 150
const SESSION_RESTORE_RETRY_MS = 96
const SCROLL_CACHE_MAX_ENTRIES = 100
const SCROLL_CACHE_KEY = 'openwaggle:scroll-positions'
const SCROLL_CACHE_ENTRY_LENGTH = 2

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

interface ScrollActions {
  readonly applyPendingRestore: () => boolean
  readonly cancelPendingRestoreRetry: () => void
  readonly cancelPendingStickToBottom: () => void
  readonly flushScrollCache: () => void
  readonly scheduleRestoreRetry: () => void
  readonly scheduleStickToBottom: () => void
  readonly scrollMessagesToBottom: (behavior?: ScrollBehavior) => void
  readonly syncButtonVisibility: () => void
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
  const actionsRef = useRef<ScrollActions | null>(null)

  activeConversationIdRef.current = activeConversationId

  const [showScrollbar, setShowScrollbar] = useState(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  function syncButtonVisibility(): void {
    setShowScrollToBottom(!shouldAutoScrollRef.current)
  }

  function saveScrollCacheSoon(): void {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      saveScrollCache(scrollCacheRef.current)
    }, SCROLL_PERSIST_DEBOUNCE_MS)
  }

  function flushScrollCache(): void {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    saveScrollCache(scrollCacheRef.current)
  }

  function rememberScrollPosition(conversationId: string | null, scrollTop: number): void {
    if (!conversationId) return
    scrollCacheRef.current.delete(conversationId)
    scrollCacheRef.current.set(conversationId, Math.max(0, scrollTop))
    saveScrollCacheSoon()
  }

  function showScrollbarTemporarily(): void {
    setShowScrollbar(true)
    if (scrollbarTimerRef.current) clearTimeout(scrollbarTimerRef.current)
    scrollbarTimerRef.current = setTimeout(() => {
      setShowScrollbar(false)
    }, SCROLLBAR_HIDE_DELAY_MS)
  }

  function cancelPendingStickToBottom(): void {
    const pendingFrame = pendingAutoScrollFrameRef.current
    if (pendingFrame === null) return
    pendingAutoScrollFrameRef.current = null
    window.cancelAnimationFrame(pendingFrame)
  }

  function cancelPendingRestoreRetry(): void {
    if (pendingRestoreTimerRef.current) {
      clearTimeout(pendingRestoreTimerRef.current)
      pendingRestoreTimerRef.current = null
    }
  }

  function scrollMessagesToBottom(behavior: ScrollBehavior = 'auto'): void {
    const scrollContainer = scrollerRef.current
    if (!scrollContainer) return
    scrollElementToBottom(scrollContainer, behavior)
    lastKnownScrollTopRef.current = scrollContainer.scrollTop
    shouldAutoScrollRef.current = true
    pendingUserScrollUpIntentRef.current = false
    pendingRestoreScrollTopRef.current = null
    syncButtonVisibility()
    rememberScrollPosition(activeConversationIdRef.current, scrollContainer.scrollTop)
  }

  function scheduleStickToBottom(): void {
    if (pendingAutoScrollFrameRef.current !== null) return
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null
      if (!shouldAutoScrollRef.current) return
      scrollMessagesToBottom()
    })
  }

  function applyPendingRestore(): boolean {
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
  }

  function scheduleRestoreRetry(): void {
    if (pendingRestoreTimerRef.current !== null) return
    pendingRestoreTimerRef.current = setTimeout(() => {
      pendingRestoreTimerRef.current = null
      if (applyPendingRestore()) {
        scheduleRestoreRetry()
      }
    }, SESSION_RESTORE_RETRY_MS)
  }

  function scrollToBottom(): void {
    cancelPendingStickToBottom()
    cancelPendingRestoreRetry()
    scrollMessagesToBottom('smooth')
    scheduleStickToBottom()
  }

  function handleScroll(): void {
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
  }

  function optOutOfAutoScrollForUserIntent(): void {
    const scrollContainer = scrollerRef.current
    pendingUserScrollUpIntentRef.current = true
    if (!scrollContainer || scrollContainer.scrollTop <= 0) return

    shouldAutoScrollRef.current = false
    cancelPendingStickToBottom()
    syncButtonVisibility()
  }

  function handleWheel(event: ScrollWheelEvent): void {
    if (event.deltaY < 0) {
      optOutOfAutoScrollForUserIntent()
    }
  }

  function handlePointerDown(): void {
    isPointerScrollActiveRef.current = true
  }

  function handlePointerUp(): void {
    isPointerScrollActiveRef.current = false
  }

  function handlePointerCancel(): void {
    isPointerScrollActiveRef.current = false
  }

  function handleTouchStart(event: ScrollTouchEvent): void {
    const touch = event.touches[0]
    if (!touch) return
    lastTouchClientYRef.current = touch.clientY
  }

  function handleTouchMove(event: ScrollTouchEvent): void {
    const touch = event.touches[0]
    if (!touch) return
    const previousTouchY = lastTouchClientYRef.current
    if (previousTouchY !== null && touch.clientY > previousTouchY + SCROLL_UP_HYSTERESIS_PX) {
      optOutOfAutoScrollForUserIntent()
    }
    lastTouchClientYRef.current = touch.clientY
  }

  function handleTouchEnd(): void {
    lastTouchClientYRef.current = null
  }

  actionsRef.current = {
    applyPendingRestore,
    cancelPendingRestoreRetry,
    cancelPendingStickToBottom,
    flushScrollCache,
    scheduleRestoreRetry,
    scheduleStickToBottom,
    scrollMessagesToBottom,
    syncButtonVisibility,
  }

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      const actions = actionsRef.current
      if (!actions) return
      if (pendingRestoreScrollTopRef.current !== null) {
        if (actions.applyPendingRestore()) {
          actions.scheduleRestoreRetry()
        }
        return
      }
      if (!shouldAutoScrollRef.current) return
      actions.scheduleStickToBottom()
    })

    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const actions = actionsRef.current
    if (!actions) return

    const previous = lastRestoredConversationRef.current
    if (previous && previous !== activeConversationId) {
      actions.flushScrollCache()
      switchBaselineLastUserMessageIdRef.current = previousLastUserMessageIdRef.current
    }

    hasRestoredScrollRef.current = false
    lastRestoredConversationRef.current = activeConversationId
    pendingRestoreScrollTopRef.current = null
    pendingUserScrollUpIntentRef.current = false
    shouldAutoScrollRef.current = true
    lastTouchClientYRef.current = null
    isPointerScrollActiveRef.current = false
    actions.cancelPendingStickToBottom()
    actions.cancelPendingRestoreRetry()
    actions.syncButtonVisibility()
  }, [activeConversationId])

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
    const actions = actionsRef.current
    if (!actions) return

    const persisted = scrollCacheRef.current.get(activeConversationId)
    if (persisted !== undefined && persisted > 0) {
      pendingRestoreScrollTopRef.current = persisted
      if (actions.applyPendingRestore()) {
        actions.scheduleRestoreRetry()
      }
    } else {
      actions.scrollMessagesToBottom()
    }

    hasRestoredScrollRef.current = true
  }, [activeConversationId, lastUserMessageId, rowsLength, userDidSend])

  useLayoutEffect(() => {
    previousLastUserMessageIdRef.current = lastUserMessageId
  }, [lastUserMessageId])

  useLayoutEffect(() => {
    if (!userDidSend) return
    if (!isLoading) return
    if (rowsLength === 0) return
    if (!scrollerRef.current) return

    const actions = actionsRef.current
    if (!actions) return

    actions.cancelPendingRestoreRetry()
    pendingRestoreScrollTopRef.current = null
    shouldAutoScrollRef.current = true
    pendingUserScrollUpIntentRef.current = false
    hasRestoredScrollRef.current = true
    actions.scrollMessagesToBottom()
    actions.scheduleStickToBottom()
    onUserDidSendConsumed()
  }, [isLoading, onUserDidSendConsumed, rowsLength, userDidSend])

  useLayoutEffect(() => {
    const hasContentSignal = rowsLength > 0 || streamVersion > 0
    if (!isLoading && !hasContentSignal) return
    if (!shouldAutoScrollRef.current) return
    actionsRef.current?.scheduleStickToBottom()
  }, [isLoading, rowsLength, streamVersion])

  useLayoutEffect(() => {
    return () => {
      actionsRef.current?.cancelPendingStickToBottom()
      actionsRef.current?.cancelPendingRestoreRetry()
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
  }, [])

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
