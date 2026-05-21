import type { RefObject } from 'react'

export interface ScrollWheelEvent {
  readonly deltaY: number
}

export interface ScrollTouchEvent {
  readonly touches: ArrayLike<{ readonly clientY: number }>
}

export interface UseChatScrollBehaviourParams {
  readonly activeSessionId: string | null
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

export interface ScrollActions {
  readonly applyPendingRestore: () => boolean
  readonly cancelPendingRestoreRetry: () => void
  readonly cancelPendingStickToBottom: () => void
  readonly flushScrollCache: () => void
  readonly scheduleRestoreRetry: () => void
  readonly scheduleStickToBottom: () => void
  readonly scrollMessagesToBottom: (behavior?: ScrollBehavior) => void
  readonly syncButtonVisibility: () => void
}

export interface MutableValueRef<T> {
  current: T
}
