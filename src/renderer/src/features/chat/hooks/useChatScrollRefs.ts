import { useRef } from 'react'
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
  const scrollCacheRef = useRef<Map<string, number>>(loadScrollCache())
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const actionsRef = useRef<ScrollActions | null>(null)

  const effectRefs = useStableEffectRefs({
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
  })

  return {
    ...effectRefs,
    lastKnownScrollTopRef,
    activeSessionIdRef,
    pendingAutoScrollFrameRef,
    pendingRestoreTimerRef,
    effectRefs,
  }
}

function useStableEffectRefs(refs: ScrollEffectRefs) {
  const effectRefsRef = useRef<ScrollEffectRefs | null>(null)
  if (!effectRefsRef.current) {
    effectRefsRef.current = refs
  }
  return effectRefsRef.current
}
