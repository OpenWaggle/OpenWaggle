import { useLayoutEffect } from 'react';
import { saveScrollCache } from './chat-scroll-cache';
function clearSessionScrollState(activeSessionId, refs) {
    const actions = refs.actionsRef.current;
    if (!actions)
        return;
    const previous = refs.lastRestoredSessionRef.current;
    if (previous && previous !== activeSessionId) {
        actions.flushScrollCache();
        refs.switchBaselineLastUserMessageIdRef.current = refs.previousLastUserMessageIdRef.current;
    }
    refs.hasRestoredScrollRef.current = false;
    refs.lastRestoredSessionRef.current = activeSessionId;
    refs.pendingRestoreScrollTopRef.current = null;
    refs.pendingUserScrollUpIntentRef.current = false;
    refs.shouldAutoScrollRef.current = true;
    refs.lastTouchClientYRef.current = null;
    refs.isPointerScrollActiveRef.current = false;
    actions.cancelPendingStickToBottom();
    actions.cancelPendingRestoreRetry();
    actions.syncButtonVisibility();
}
function restoreSessionScroll({ activeSessionId, lastUserMessageId, rowsLength, userDidSend, refs, }) {
    if (refs.hasRestoredScrollRef.current || !activeSessionId || rowsLength === 0 || userDidSend) {
        return;
    }
    const switchBaselineLastUserMessageId = refs.switchBaselineLastUserMessageIdRef.current;
    if (switchBaselineLastUserMessageId !== null &&
        lastUserMessageId === switchBaselineLastUserMessageId) {
        return;
    }
    refs.switchBaselineLastUserMessageIdRef.current = null;
    const scrollContainer = refs.scrollerRef.current;
    const actions = refs.actionsRef.current;
    if (!scrollContainer || !actions)
        return;
    const persisted = refs.scrollCacheRef.current.get(activeSessionId);
    if (persisted !== undefined && persisted > 0) {
        refs.pendingRestoreScrollTopRef.current = persisted;
        if (actions.applyPendingRestore()) {
            actions.scheduleRestoreRetry();
        }
    }
    else {
        actions.scrollMessagesToBottom();
    }
    refs.hasRestoredScrollRef.current = true;
}
function consumeUserSendScroll({ isLoading, rowsLength, userDidSend, onUserDidSendConsumed, refs, }) {
    if (!userDidSend || !isLoading || rowsLength === 0 || !refs.scrollerRef.current)
        return;
    const actions = refs.actionsRef.current;
    if (!actions)
        return;
    actions.cancelPendingRestoreRetry();
    refs.pendingRestoreScrollTopRef.current = null;
    refs.shouldAutoScrollRef.current = true;
    refs.pendingUserScrollUpIntentRef.current = false;
    refs.hasRestoredScrollRef.current = true;
    actions.scrollMessagesToBottom();
    actions.scheduleStickToBottom();
    onUserDidSendConsumed();
}
function persistLatestScrollPosition(refs) {
    const sessionId = refs.lastRestoredSessionRef.current;
    const scroller = refs.scrollerRef.current;
    if (sessionId && scroller) {
        refs.scrollCacheRef.current.delete(sessionId);
        refs.scrollCacheRef.current.set(sessionId, Math.max(0, scroller.scrollTop));
    }
    saveScrollCache(refs.scrollCacheRef.current);
}
export function useChatScrollEffects(params) {
    const { activeSessionId, lastUserMessageId, rowsLength, streamVersion, isLoading, userDidSend, onUserDidSendConsumed, refs, } = params;
    useLayoutEffect(() => {
        const content = refs.contentRef.current;
        if (!content || typeof ResizeObserver === 'undefined')
            return;
        const observer = new ResizeObserver(() => {
            const actions = refs.actionsRef.current;
            if (!actions)
                return;
            if (refs.pendingRestoreScrollTopRef.current !== null) {
                if (actions.applyPendingRestore()) {
                    actions.scheduleRestoreRetry();
                }
                return;
            }
            if (!refs.shouldAutoScrollRef.current)
                return;
            actions.scheduleStickToBottom();
        });
        observer.observe(content);
        return () => observer.disconnect();
    }, [refs]);
    useLayoutEffect(() => clearSessionScrollState(activeSessionId, refs), [activeSessionId, refs]);
    useLayoutEffect(() => restoreSessionScroll({
        activeSessionId,
        lastUserMessageId,
        rowsLength,
        userDidSend,
        refs,
    }), [activeSessionId, lastUserMessageId, rowsLength, userDidSend, refs]);
    useLayoutEffect(() => {
        refs.previousLastUserMessageIdRef.current = lastUserMessageId;
    }, [lastUserMessageId, refs]);
    useLayoutEffect(() => consumeUserSendScroll({
        isLoading,
        rowsLength,
        userDidSend,
        onUserDidSendConsumed,
        refs,
    }), [isLoading, rowsLength, userDidSend, onUserDidSendConsumed, refs]);
    useLayoutEffect(() => {
        const hasContentSignal = rowsLength > 0 || streamVersion > 0;
        if (!isLoading && !hasContentSignal)
            return;
        if (!refs.shouldAutoScrollRef.current)
            return;
        refs.actionsRef.current?.scheduleStickToBottom();
    }, [isLoading, rowsLength, streamVersion, refs]);
    useLayoutEffect(() => {
        // Capture the ref objects (not their values) so cleanup is pinned to the same
        // container this effect ran for, while still reading the latest .current
        // — timers are assigned after setup (react-doctor/exhaustive-deps).
        const { actionsRef, persistTimerRef, scrollbarTimerRef } = refs;
        return () => {
            actionsRef.current?.cancelPendingStickToBottom();
            actionsRef.current?.cancelPendingRestoreRetry();
            if (persistTimerRef.current)
                clearTimeout(persistTimerRef.current);
            if (scrollbarTimerRef.current)
                clearTimeout(scrollbarTimerRef.current);
            persistLatestScrollPosition(refs);
        };
    }, [refs]);
}
