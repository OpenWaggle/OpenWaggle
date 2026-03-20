import type { MutableRefObject } from 'react'
import { useEffect, useRef } from 'react'

const DELAY_MS = 1200
const PADDING_TOP = 20
const AUTO_SCROLL_THRESHOLD_PX = 50
const SCROLL_POSITIONS_STORAGE_KEY = 'openwaggle:chat-scroll-positions:v1'
const MAX_SCROLL_POSITION_ENTRIES = 80
const SCROLL_PERSIST_DEBOUNCE_MS = 200
const MAX_SCROLL_RESTORE_ATTEMPTS = 8
const NAVIGATION_ANCHOR_SUPPRESSION_SETTLE_MS = 120

interface UseChatScrollBehaviourParams {
  lastUserMessageId: string | null
  messagesLength: number
  rowsLength: number
  isLoading: boolean
  disableAutoFollowDuringWaggleStreaming: boolean
  activeConversationId: string | null
}

interface UseChatScrollBehaviourResult {
  scrollerRef: React.RefObject<HTMLDivElement | null>
  spacerRef: React.RefObject<HTMLDivElement | null>
  userMessageRef: React.RefObject<HTMLDivElement | null>
  handleScroll: () => void
}

interface PersistedScrollPosition {
  scrollTop: number
  lastSeenUserMessageId: string | null
  updatedAt: number
}

type PersistedScrollPositionMap = Record<string, PersistedScrollPosition>
type PersistMode = 'immediate' | 'debounced'
type PersistTimerRef = MutableRefObject<ReturnType<typeof setTimeout> | null>

interface UpsertScrollPositionOptions {
  scrollTop?: number
  lastSeenUserMessageId?: string | null
  persistMode?: PersistMode
}

interface SaveConversationScrollPositionRefs {
  readonly scrollPositionsRef: MutableRefObject<PersistedScrollPositionMap>
  readonly scrollerRef: MutableRefObject<HTMLDivElement | null>
  readonly lastScrolledIdRef: MutableRefObject<string | null>
  readonly lastUserMessageIdRef: MutableRefObject<string | null>
  readonly persistTimerRef: PersistTimerRef
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sanitizeScrollTop(value: unknown): number | null {
  if (!isFiniteNumber(value) || value < 0) {
    return null
  }
  return value
}

function sanitizeUpdatedAt(value: unknown): number | null {
  if (!isFiniteNumber(value) || value <= 0) {
    return null
  }
  return value
}

function sanitizeLastSeenUserMessageId(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function pruneScrollPositions(
  positions: PersistedScrollPositionMap,
  maxEntries = MAX_SCROLL_POSITION_ENTRIES,
): PersistedScrollPositionMap {
  const sortedEntries = Object.entries(positions)
    .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .slice(0, maxEntries)

  const pruned: PersistedScrollPositionMap = {}
  for (const [conversationId, position] of sortedEntries) {
    pruned[conversationId] = position
  }
  return pruned
}

function readPersistedScrollPositions(): PersistedScrollPositionMap {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const rawValue = window.localStorage.getItem(SCROLL_POSITIONS_STORAGE_KEY)
    if (!rawValue) {
      return {}
    }

    const parsedValue = JSON.parse(rawValue)
    if (!isRecord(parsedValue)) {
      return {}
    }

    const parsedPositions: PersistedScrollPositionMap = {}
    for (const [conversationId, rawPosition] of Object.entries(parsedValue)) {
      if (!isRecord(rawPosition)) {
        continue
      }

      const scrollTop = sanitizeScrollTop(rawPosition.scrollTop)
      const updatedAt = sanitizeUpdatedAt(rawPosition.updatedAt)
      if (scrollTop === null || updatedAt === null) {
        continue
      }

      parsedPositions[conversationId] = {
        scrollTop,
        lastSeenUserMessageId: sanitizeLastSeenUserMessageId(rawPosition.lastSeenUserMessageId),
        updatedAt,
      }
    }

    return pruneScrollPositions(parsedPositions)
  } catch {
    return {}
  }
}

function writePersistedScrollPositions(positions: PersistedScrollPositionMap): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const prunedPositions = pruneScrollPositions(positions)
    window.localStorage.setItem(SCROLL_POSITIONS_STORAGE_KEY, JSON.stringify(prunedPositions))
  } catch {
    // Best effort only: ignore localStorage parse/quota/security failures.
  }
}

function clampScrollTop(scroller: HTMLDivElement, scrollTop: number): number {
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  const nonNegativeScrollTop = Math.max(0, scrollTop)
  return Math.min(nonNegativeScrollTop, maxScrollTop)
}

function schedulePersistedScrollWrite(
  persistTimerRef: PersistTimerRef,
  scrollPositionsRef: MutableRefObject<PersistedScrollPositionMap>,
): void {
  if (persistTimerRef.current) {
    clearTimeout(persistTimerRef.current)
  }
  persistTimerRef.current = setTimeout(() => {
    persistTimerRef.current = null
    writePersistedScrollPositions(scrollPositionsRef.current)
  }, SCROLL_PERSIST_DEBOUNCE_MS)
}

function upsertScrollPosition(
  scrollPositionsRef: MutableRefObject<PersistedScrollPositionMap>,
  persistTimerRef: PersistTimerRef,
  conversationId: string,
  options?: UpsertScrollPositionOptions,
): void {
  const existing = scrollPositionsRef.current[conversationId]
  const next: PersistedScrollPosition = {
    scrollTop: options?.scrollTop ?? existing?.scrollTop ?? 0,
    lastSeenUserMessageId:
      options?.lastSeenUserMessageId ?? existing?.lastSeenUserMessageId ?? null,
    updatedAt: Date.now(),
  }
  scrollPositionsRef.current = pruneScrollPositions({
    ...scrollPositionsRef.current,
    [conversationId]: next,
  })

  if (options?.persistMode === 'immediate') {
    writePersistedScrollPositions(scrollPositionsRef.current)
    return
  }

  schedulePersistedScrollWrite(persistTimerRef, scrollPositionsRef)
}

function saveConversationScrollPosition(
  conversationId: string | null,
  persistMode: PersistMode,
  refs: SaveConversationScrollPositionRefs,
): void {
  if (!conversationId) {
    return
  }

  const existing = refs.scrollPositionsRef.current[conversationId]
  const scroller = refs.scrollerRef.current
  const scrollTop = scroller ? Math.max(0, scroller.scrollTop) : (existing?.scrollTop ?? 0)
  const lastSeenUserMessageId =
    refs.lastScrolledIdRef.current ??
    refs.lastUserMessageIdRef.current ??
    existing?.lastSeenUserMessageId ??
    null

  upsertScrollPosition(refs.scrollPositionsRef, refs.persistTimerRef, conversationId, {
    scrollTop,
    lastSeenUserMessageId,
    persistMode,
  })
}

/**
 * Manages all scroll behaviour for the chat transcript:
 * - Scroll to user message on send (Voyager pattern via direct ref + offsetTop)
 * - Persist per-thread scroll position (restore on navigation, including restarts)
 * - Scroll to bottom on initial conversation load
 * - Auto-scroll during streaming when near bottom
 * - Scrollbar hide animation
 * - Spacer management for scroll reachability
 */
export function useChatScrollBehaviour({
  lastUserMessageId,
  messagesLength,
  rowsLength,
  isLoading,
  disableAutoFollowDuringWaggleStreaming,
  activeConversationId,
}: UseChatScrollBehaviourParams): UseChatScrollBehaviourResult {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const userMessageRef = useRef<HTMLDivElement>(null)
  const lastScrolledIdRef = useRef<string | null>(null)
  const scrollPositionsRef = useRef<PersistedScrollPositionMap>(readPersistedScrollPositions())
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeConversationIdRef = useRef<string | null>(activeConversationId)
  const previousConversationIdRef = useRef<string | null>(activeConversationId)
  const lastKnownConversationIdRef = useRef<string | null>(activeConversationId)
  const rowsLengthRef = useRef(rowsLength)
  rowsLengthRef.current = rowsLength
  const suppressUserAnchorDuringNavigationRef = useRef(false)
  const navigationAnchorSettleSnapshotRef = useRef<{
    conversationId: string
    lastUserMessageId: string | null
    rowsLength: number
  } | null>(null)
  const navigationAnchorSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousMessagesLengthRef = useRef(messagesLength)
  const previousIsLoadingRef = useRef(isLoading)
  activeConversationIdRef.current = activeConversationId
  if (activeConversationId) {
    lastKnownConversationIdRef.current = activeConversationId
  }
  const lastUserMessageIdRef = useRef(lastUserMessageId)
  lastUserMessageIdRef.current = lastUserMessageId
  const scrollPersistenceRefsRef = useRef<SaveConversationScrollPositionRefs>({
    scrollPositionsRef,
    scrollerRef,
    lastScrolledIdRef,
    lastUserMessageIdRef,
    persistTimerRef,
  })

  // On thread switch: save outgoing position, prepare incoming seen-message state, and clear spacer.
  const hasAppliedInitialPositionRef = useRef(false)
  const initialPositionConversationRef = useRef<string | null>(activeConversationId)
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeConversationId intentionally drives thread switching behavior
  useEffect(() => {
    const previousConversationId = previousConversationIdRef.current
    const didConversationChange = previousConversationId !== activeConversationId
    if (didConversationChange && activeConversationId) {
      suppressUserAnchorDuringNavigationRef.current = true
      navigationAnchorSettleSnapshotRef.current = null
      if (navigationAnchorSettleTimerRef.current) {
        clearTimeout(navigationAnchorSettleTimerRef.current)
        navigationAnchorSettleTimerRef.current = null
      }
    }
    if (previousConversationId && previousConversationId !== activeConversationId) {
      const previousEntry = scrollPositionsRef.current[previousConversationId]
      if (previousEntry) {
        scrollPositionsRef.current = pruneScrollPositions({
          ...scrollPositionsRef.current,
          [previousConversationId]: {
            ...previousEntry,
            lastSeenUserMessageId:
              lastScrolledIdRef.current ?? previousEntry.lastSeenUserMessageId ?? null,
            updatedAt: Date.now(),
          },
        })
        writePersistedScrollPositions(scrollPositionsRef.current)
      } else {
        saveConversationScrollPosition(
          previousConversationId,
          'immediate',
          scrollPersistenceRefsRef.current,
        )
      }
    }
    previousConversationIdRef.current = activeConversationId

    if (spacerRef.current) {
      spacerRef.current.style.height = '0px'
    }

    const persisted = activeConversationId
      ? scrollPositionsRef.current[activeConversationId]
      : undefined
    const seenMessageId = persisted?.lastSeenUserMessageId ?? lastUserMessageId ?? null
    lastScrolledIdRef.current = seenMessageId
    if (activeConversationId && persisted) {
      upsertScrollPosition(scrollPositionsRef, persistTimerRef, activeConversationId, {
        scrollTop: persisted.scrollTop,
        lastSeenUserMessageId: seenMessageId,
      })
    }

    hasAppliedInitialPositionRef.current = false
    initialPositionConversationRef.current = activeConversationId
  }, [activeConversationId])

  // Restore saved per-thread scroll position once rows are present.
  // If there is no saved position, keep current fallback behavior (auto-bottom).
  useEffect(() => {
    if (initialPositionConversationRef.current !== activeConversationId) {
      return
    }
    if (hasAppliedInitialPositionRef.current) {
      return
    }
    if (!activeConversationId) {
      hasAppliedInitialPositionRef.current = true
      return
    }
    if (rowsLength === 0) {
      return
    }

    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }

    const persisted = scrollPositionsRef.current[activeConversationId]
    if (persisted) {
      const restorePersistedScrollTop = (attempt: number): void => {
        requestAnimationFrame(() => {
          const nextScroller = scrollerRef.current
          if (!nextScroller) {
            return
          }
          const maxScrollTop = Math.max(0, nextScroller.scrollHeight - nextScroller.clientHeight)
          const shouldRetry = maxScrollTop <= 0 && attempt < MAX_SCROLL_RESTORE_ATTEMPTS
          if (shouldRetry) {
            restorePersistedScrollTop(attempt + 1)
            return
          }
          const clampedScrollTop = clampScrollTop(nextScroller, persisted.scrollTop)
          nextScroller.scrollTop = clampedScrollTop
          hasAppliedInitialPositionRef.current = true
          saveConversationScrollPosition(
            activeConversationId,
            'debounced',
            scrollPersistenceRefsRef.current,
          )
        })
      }

      restorePersistedScrollTop(0)
      return
    }

    if (disableAutoFollowDuringWaggleStreaming) {
      return
    }

    scroller.scrollTop = scroller.scrollHeight
    hasAppliedInitialPositionRef.current = true
    const seenMessageId = lastUserMessageIdRef.current
    lastScrolledIdRef.current = seenMessageId
    saveConversationScrollPosition(
      activeConversationId,
      'debounced',
      scrollPersistenceRefsRef.current,
    )
  }, [activeConversationId, disableAutoFollowDuringWaggleStreaming, rowsLength])

  // Scroll the last user message to near the top when lastUserMessageId changes.
  // Uses element.offsetTop (absolute, relative to position:relative scrollerRef) —
  // identical to Voyager's scrollToElement(element, offset) formula.
  useEffect(() => {
    if (!activeConversationId) {
      return
    }

    const isHydratingAfterNavigation = suppressUserAnchorDuringNavigationRef.current
    const hasUnreadUserMessage =
      lastUserMessageId !== null && lastUserMessageId !== lastScrolledIdRef.current
    const previousNavigationSnapshot = navigationAnchorSettleSnapshotRef.current
    const hadSettledNavigationBaseline =
      previousNavigationSnapshot?.conversationId === activeConversationId &&
      previousNavigationSnapshot.rowsLength > 0 &&
      previousNavigationSnapshot.lastUserMessageId === lastScrolledIdRef.current
    const didOptimisticUserMessageAppend =
      previousMessagesLengthRef.current > 0 &&
      messagesLength === previousMessagesLengthRef.current + 1
    const didUserStartLoadingInActiveThread = isLoading && !previousIsLoadingRef.current
    const shouldAllowImmediateUserAnchor =
      isHydratingAfterNavigation &&
      hasUnreadUserMessage &&
      hadSettledNavigationBaseline &&
      didOptimisticUserMessageAppend &&
      didUserStartLoadingInActiveThread

    if (shouldAllowImmediateUserAnchor) {
      suppressUserAnchorDuringNavigationRef.current = false
      navigationAnchorSettleSnapshotRef.current = null
      if (navigationAnchorSettleTimerRef.current) {
        clearTimeout(navigationAnchorSettleTimerRef.current)
        navigationAnchorSettleTimerRef.current = null
      }
    }

    // During thread hydration, user message IDs can flip multiple times as state settles.
    // Treat all interim IDs as baseline and only re-enable send-anchor after values stabilize.
    if (suppressUserAnchorDuringNavigationRef.current) {
      if (hasUnreadUserMessage) {
        lastScrolledIdRef.current = lastUserMessageId
        upsertScrollPosition(scrollPositionsRef, persistTimerRef, activeConversationId, {
          lastSeenUserMessageId: lastUserMessageId,
        })
      }

      const settleSnapshot = {
        activeConversationId,
        lastUserMessageId,
        rowsLength,
      } as const
      navigationAnchorSettleSnapshotRef.current = {
        conversationId: settleSnapshot.activeConversationId,
        lastUserMessageId: settleSnapshot.lastUserMessageId,
        rowsLength: settleSnapshot.rowsLength,
      }
      if (navigationAnchorSettleTimerRef.current) {
        clearTimeout(navigationAnchorSettleTimerRef.current)
      }
      navigationAnchorSettleTimerRef.current = setTimeout(() => {
        const snapshot = navigationAnchorSettleSnapshotRef.current
        if (!snapshot) {
          return
        }
        if (
          suppressUserAnchorDuringNavigationRef.current &&
          activeConversationIdRef.current === snapshot.conversationId &&
          lastUserMessageIdRef.current === snapshot.lastUserMessageId &&
          rowsLengthRef.current === snapshot.rowsLength
        ) {
          suppressUserAnchorDuringNavigationRef.current = false
          navigationAnchorSettleTimerRef.current = null
        }
      }, NAVIGATION_ANCHOR_SUPPRESSION_SETTLE_MS)
      return
    }

    const isNewUserMessage =
      lastUserMessageId !== null && lastUserMessageId !== lastScrolledIdRef.current

    if (isNewUserMessage && messagesLength > 0) {
      lastScrolledIdRef.current = lastUserMessageId
      upsertScrollPosition(scrollPositionsRef, persistTimerRef, activeConversationId, {
        lastSeenUserMessageId: lastUserMessageId,
      })

      requestAnimationFrame(() => {
        if (!userMessageRef.current || !scrollerRef.current) return
        const scroller = scrollerRef.current
        const el = userMessageRef.current
        const targetScrollTop = Math.max(0, el.offsetTop - PADDING_TOP)
        // Add only the minimum spacer height needed for this scroll to be reachable.
        // Required: scrollHeight >= targetScrollTop + clientHeight
        const needed = targetScrollTop + scroller.clientHeight - scroller.scrollHeight
        if (spacerRef.current) {
          spacerRef.current.style.height = needed > 0 ? `${needed}px` : '0px'
        }
        scroller.scrollTo({ top: targetScrollTop, behavior: 'smooth' })
        saveConversationScrollPosition(
          activeConversationId,
          'debounced',
          scrollPersistenceRefsRef.current,
        )
      })
    }
  }, [activeConversationId, isLoading, lastUserMessageId, rowsLength, messagesLength])

  useEffect(() => {
    previousMessagesLengthRef.current = messagesLength
    previousIsLoadingRef.current = isLoading
  }, [isLoading, messagesLength])

  // Auto-scroll to bottom during streaming when near the bottom.
  const prevRowCountRef = useRef(rowsLength)
  useEffect(() => {
    if (!isLoading) return
    if (disableAutoFollowDuringWaggleStreaming) return
    if (rowsLength === prevRowCountRef.current) return
    prevRowCountRef.current = rowsLength
    if (!scrollerRef.current) return
    const el = scrollerRef.current
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < AUTO_SCROLL_THRESHOLD_PX) {
      el.scrollTop = el.scrollHeight
      saveConversationScrollPosition(
        activeConversationId ?? lastKnownConversationIdRef.current,
        'debounced',
        scrollPersistenceRefsRef.current,
      )
    }
  }, [activeConversationId, isLoading, disableAutoFollowDuringWaggleStreaming, rowsLength])

  // Keep per-thread scroll memory in sync with native scroll events.
  // This guards against timing gaps where React's synthetic onScroll may not have fired yet.
  useEffect(() => {
    const scroller = scrollerRef.current
    const conversationId = activeConversationId ?? lastKnownConversationIdRef.current
    if (!scroller || !conversationId) {
      return
    }

    const syncScrollPosition = (): void => {
      upsertScrollPosition(scrollPositionsRef, persistTimerRef, conversationId, {
        scrollTop: Math.max(0, scroller.scrollTop),
        lastSeenUserMessageId: lastScrolledIdRef.current ?? lastUserMessageIdRef.current ?? null,
      })
    }

    scroller.addEventListener('scroll', syncScrollPosition, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', syncScrollPosition)
    }
  }, [activeConversationId])

  // Scrollbar hide animation — adds/removes is-scrolling class on scroll.
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  function handleScroll(): void {
    const el = scrollerRef.current
    if (!el) return
    el.classList.add('is-scrolling')
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => el.classList.remove('is-scrolling'), DELAY_MS)
    saveConversationScrollPosition(
      activeConversationIdRef.current ?? lastKnownConversationIdRef.current,
      'debounced',
      scrollPersistenceRefsRef.current,
    )
  }

  useEffect(
    () => () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current)
      }
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
      if (navigationAnchorSettleTimerRef.current) {
        clearTimeout(navigationAnchorSettleTimerRef.current)
        navigationAnchorSettleTimerRef.current = null
      }
      saveConversationScrollPosition(
        activeConversationIdRef.current ?? lastKnownConversationIdRef.current,
        'immediate',
        scrollPersistenceRefsRef.current,
      )
    },
    [],
  )

  return { scrollerRef, spacerRef, userMessageRef, handleScroll }
}
