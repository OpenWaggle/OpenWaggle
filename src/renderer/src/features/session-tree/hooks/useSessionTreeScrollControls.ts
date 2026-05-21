import { useLayoutEffect, useRef, useState } from 'react'
import { isScrollContainerNearBottom, scrollElementToBottom } from '@/features/chat/lib'

function shouldShowSessionTreeScrollButton(input: {
  readonly scrollContainer: HTMLElement | null
  readonly scrollToBottomInProgressRef: { current: boolean }
}) {
  if (!input.scrollContainer) {
    return false
  }

  const hasScrollableContent =
    input.scrollContainer.scrollHeight > input.scrollContainer.clientHeight
  const nearBottom = isScrollContainerNearBottom(input.scrollContainer)
  if (input.scrollToBottomInProgressRef.current) {
    if (!hasScrollableContent || nearBottom) {
      input.scrollToBottomInProgressRef.current = false
    }
    return false
  }

  return hasScrollableContent && !nearBottom
}

export function useSessionTreeScrollControls() {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const treeScrollToBottomInProgressRef = useRef(false)
  const [showTreeScrollToBottom, setShowTreeScrollToBottom] = useState(false)

  function syncTreeScrollButtonVisibility() {
    setShowTreeScrollToBottom(
      shouldShowSessionTreeScrollButton({
        scrollContainer: scrollContainerRef.current,
        scrollToBottomInProgressRef: treeScrollToBottomInProgressRef,
      }),
    )
  }

  function scrollToTreeBottom() {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) {
      return
    }
    treeScrollToBottomInProgressRef.current = true
    scrollElementToBottom(scrollContainer, 'smooth')
    setShowTreeScrollToBottom(false)
  }

  useLayoutEffect(syncTreeScrollButtonVisibility)

  return {
    scrollContainerRef,
    showTreeScrollToBottom,
    syncTreeScrollButtonVisibility,
    scrollToTreeBottom,
  }
}
