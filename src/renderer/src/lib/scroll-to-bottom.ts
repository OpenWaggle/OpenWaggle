const DEFAULT_BOTTOM_THRESHOLD_PX = 64
const MIN_SCROLL_POSITION_PX = 0

export interface ScrollPosition {
  readonly scrollTop: number
  readonly clientHeight: number
  readonly scrollHeight: number
}

export function isScrollContainerNearBottom(
  position: ScrollPosition,
  thresholdPx = DEFAULT_BOTTOM_THRESHOLD_PX,
): boolean {
  const threshold = Number.isFinite(thresholdPx)
    ? Math.max(MIN_SCROLL_POSITION_PX, thresholdPx)
    : DEFAULT_BOTTOM_THRESHOLD_PX
  const { scrollTop, clientHeight, scrollHeight } = position
  if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite)) {
    return true
  }
  return scrollHeight - clientHeight - scrollTop <= threshold
}

export function getMaxScrollTop(el: HTMLElement): number {
  return Math.max(MIN_SCROLL_POSITION_PX, el.scrollHeight - el.clientHeight)
}

export function scrollElementToBottom(el: HTMLElement, behavior: ScrollBehavior): void {
  if (typeof el.scrollTo === 'function') {
    el.scrollTo({ top: el.scrollHeight, behavior })
    return
  }
  el.scrollTop = el.scrollHeight
}
