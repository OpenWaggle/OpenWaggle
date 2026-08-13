const DEFAULT_BOTTOM_THRESHOLD_PX = 64;
const MIN_SCROLL_POSITION_PX = 0;
export function isScrollContainerNearBottom(position, thresholdPx = DEFAULT_BOTTOM_THRESHOLD_PX) {
    const threshold = Number.isFinite(thresholdPx)
        ? Math.max(MIN_SCROLL_POSITION_PX, thresholdPx)
        : DEFAULT_BOTTOM_THRESHOLD_PX;
    const { scrollTop, clientHeight, scrollHeight } = position;
    if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite)) {
        return true;
    }
    return scrollHeight - clientHeight - scrollTop <= threshold;
}
export function getMaxScrollTop(el) {
    return Math.max(MIN_SCROLL_POSITION_PX, el.scrollHeight - el.clientHeight);
}
export function scrollElementToBottom(el, behavior) {
    if (typeof el.scrollTo === 'function') {
        el.scrollTo({ top: el.scrollHeight, behavior });
        return;
    }
    el.scrollTop = el.scrollHeight;
}
