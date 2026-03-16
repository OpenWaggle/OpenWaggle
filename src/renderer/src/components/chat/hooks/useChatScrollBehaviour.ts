import { useEffect, useRef } from 'react'

const DELAY_MS = 1200
const PADDING_TOP = 20

interface UseChatScrollBehaviourParams {
  lastUserMessageId: string | null
  messagesLength: number
  rowsLength: number
  isLoading: boolean
  activeConversationId: string | null
}

interface UseChatScrollBehaviourResult {
  scrollerRef: React.RefObject<HTMLDivElement | null>
  spacerRef: React.RefObject<HTMLDivElement | null>
  userMessageRef: React.RefObject<HTMLDivElement | null>
  handleScroll: () => void
}

/**
 * Manages all scroll behaviour for the chat transcript:
 * - Scroll to user message on send (Voyager pattern via direct ref + offsetTop)
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
  activeConversationId,
}: UseChatScrollBehaviourParams): UseChatScrollBehaviourResult {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const userMessageRef = useRef<HTMLDivElement>(null)
  const lastScrolledIdRef = useRef<string | null>(null)

  // Scroll the last user message to near the top when lastUserMessageId changes.
  // Uses element.offsetTop (absolute, relative to position:relative scrollerRef) —
  // identical to Voyager's scrollToElement(element, offset) formula.
  useEffect(() => {
    const isNewUserMessage =
      lastUserMessageId !== null && lastUserMessageId !== lastScrolledIdRef.current

    if (isNewUserMessage && messagesLength > 1) {
      lastScrolledIdRef.current = lastUserMessageId

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
      })
    }
  }, [lastUserMessageId, messagesLength])

  // Reset spacer and scroll tracking when conversation changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeConversationId intentionally triggers reset
  useEffect(() => {
    if (spacerRef.current) {
      spacerRef.current.style.height = '0px'
    }
    lastScrolledIdRef.current = null
  }, [activeConversationId])

  // Scroll to bottom when a conversation first loads.
  const hasScrolledToBottomRef = useRef(false)
  const conversationIdRef = useRef(activeConversationId)
  useEffect(() => {
    if (conversationIdRef.current !== activeConversationId) {
      conversationIdRef.current = activeConversationId
      hasScrolledToBottomRef.current = false
    }
    if (hasScrolledToBottomRef.current) return
    if (rowsLength === 0) return
    hasScrolledToBottomRef.current = true
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
    }
  }, [activeConversationId, rowsLength])

  // Auto-scroll to bottom during streaming when near the bottom.
  const prevRowCountRef = useRef(rowsLength)
  useEffect(() => {
    if (!isLoading) return
    if (rowsLength === prevRowCountRef.current) return
    prevRowCountRef.current = rowsLength
    if (!scrollerRef.current) return
    const el = scrollerRef.current
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 50) {
      el.scrollTop = el.scrollHeight
    }
  }, [isLoading, rowsLength])

  // Scrollbar hide animation — adds/removes is-scrolling class on scroll.
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  function handleScroll(): void {
    const el = scrollerRef.current
    if (!el) return
    el.classList.add('is-scrolling')
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => el.classList.remove('is-scrolling'), DELAY_MS)
  }

  return { scrollerRef, spacerRef, userMessageRef, handleScroll }
}
