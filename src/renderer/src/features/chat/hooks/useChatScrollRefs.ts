import { useMemo, useRef, useState } from 'react'
import { loadScrollCache } from './chat-scroll-cache'
import type { MutableValueRef, ScrollActions } from './chat-scroll-types'
import type { ScrollEffectRefs } from './useChatScrollEffects'

interface ChatScrollRefs extends ScrollEffectRefs {
  readonly lastKnownScrollTopRef: MutableValueRef<number>
  readonly activeSessionIdRef: MutableValueRef<string | null>
  readonly pendingAutoScrollFrameRef: MutableValueRef<number | null>
  readonly pendingRestoreTimerRef: MutableValueRef<ReturnType<typeof setTimeout> | null>
  readonly effectRefs: ScrollEffectRefs
}

export function useChatScrollRefs(
  activeSessionId: string | null,
  lastUserMessageId: string | null,
): ChatScrollRefs {
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
  const lastRestoredSessionRef = useRef<string | null>(null)
  const hasRestoredScrollRef = useRef(false)
  const activeSessionIdRef = useRef(activeSessionId)
  const previousLastUserMessageIdRef = useRef(lastUserMessageId)
  const switchBaselineLastUserMessageIdRef = useRef<string | null>(null)
  // useState's lazy initializer runs loadScrollCache() exactly once. Passing it
  // straight to useRef would re-read localStorage and re-parse JSON on every
  // render only to discard the result (react-doctor/rerender-lazy-ref-init).
  const [initialScrollCache] = useState(loadScrollCache)
  const scrollCacheRef = useRef<Map<string, number>>(initialScrollCache)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const actionsRef = useRef<ScrollActions | null>(null)

  const effectRefs = useMemo<ScrollEffectRefs>(
    () => ({
      scrollerRef,
      contentRef,
      shouldAutoScrollRef,
      lastTouchClientYRef,
      pendingUserScrollUpIntentRef,
      isPointerScrollActiveRef,
      pendingRestoreScrollTopRef,
      lastRestoredSessionRef,
      hasRestoredScrollRef,
      previousLastUserMessageIdRef,
      switchBaselineLastUserMessageIdRef,
      scrollCacheRef,
      persistTimerRef,
      scrollbarTimerRef,
      actionsRef,
    }),
    // Every member is a useRef result, so identities are stable for the
    // component's lifetime and the object never needs rebuilding. Building it
    // in a memo (rather than freezing a render-phase ref write) keeps render
    // pure — react-doctor/no-ref-current-in-render.
    [],
  )

  return {
    ...effectRefs,
    lastKnownScrollTopRef,
    activeSessionIdRef,
    pendingAutoScrollFrameRef,
    pendingRestoreTimerRef,
    effectRefs,
  }
}
