import { useEffect, useRef } from 'react'

interface UseAutoScrollOptions {
  enabled: boolean
  skipWhileStreaming: boolean
}

/** Distance from the bottom (in px) within which the user is considered "at the bottom". */
const SCROLL_THRESHOLD = 48

export function useAutoScroll({ enabled, skipWhileStreaming }: UseAutoScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  /** Tracks whether the user has manually scrolled away from the bottom. */
  const userScrolledUpRef = useRef(false)

  useEffect(() => {
    if (!enabled || skipWhileStreaming) return
    // Only auto-scroll if the user hasn't scrolled up manually
    if (userScrolledUpRef.current) {
      // Reset the flag when streaming ends (skipWhileStreaming flips false)
      // so the next stream starts at the bottom again.
      userScrolledUpRef.current = false
      return
    }
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [enabled, skipWhileStreaming])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return

    // Detect whether the user is near the bottom
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userScrolledUpRef.current = distanceFromBottom > SCROLL_THRESHOLD

    el.classList.add('is-scrolling')
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      el.classList.remove('is-scrolling')
    }, 1200)
  }

  return { scrollRef, handleScroll }
}
