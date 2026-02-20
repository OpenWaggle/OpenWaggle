import { useEffect, useRef } from 'react'

interface UseAutoScrollOptions {
  enabled: boolean
  skipWhileStreaming: boolean
}

export function useAutoScroll({ enabled, skipWhileStreaming }: UseAutoScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    if (!enabled || skipWhileStreaming) return
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [enabled, skipWhileStreaming])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    el.classList.add('is-scrolling')
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      el.classList.remove('is-scrolling')
    }, 1200)
  }

  return { scrollRef, handleScroll }
}
