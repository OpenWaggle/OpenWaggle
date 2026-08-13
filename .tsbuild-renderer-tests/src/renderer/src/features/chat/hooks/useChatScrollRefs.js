import { useMemo, useRef, useState } from 'react';
import { loadScrollCache } from './chat-scroll-cache';
export function useChatScrollRefs(activeSessionId, lastUserMessageId) {
    const scrollerRef = useRef(null);
    const contentRef = useRef(null);
    const shouldAutoScrollRef = useRef(true);
    const lastKnownScrollTopRef = useRef(0);
    const isPointerScrollActiveRef = useRef(false);
    const lastTouchClientYRef = useRef(null);
    const pendingUserScrollUpIntentRef = useRef(false);
    const pendingAutoScrollFrameRef = useRef(null);
    const pendingRestoreTimerRef = useRef(null);
    const pendingRestoreScrollTopRef = useRef(null);
    const lastRestoredSessionRef = useRef(null);
    const hasRestoredScrollRef = useRef(false);
    const activeSessionIdRef = useRef(activeSessionId);
    const previousLastUserMessageIdRef = useRef(lastUserMessageId);
    const switchBaselineLastUserMessageIdRef = useRef(null);
    // useState's lazy initializer runs loadScrollCache() exactly once. Passing it
    // straight to useRef would re-read localStorage and re-parse JSON on every
    // render only to discard the result (react-doctor/rerender-lazy-ref-init).
    const [initialScrollCache] = useState(loadScrollCache);
    const scrollCacheRef = useRef(initialScrollCache);
    const persistTimerRef = useRef(null);
    const scrollbarTimerRef = useRef(null);
    const actionsRef = useRef(null);
    const effectRefs = useMemo(() => ({
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
    []);
    return {
        ...effectRefs,
        lastKnownScrollTopRef,
        activeSessionIdRef,
        pendingAutoScrollFrameRef,
        pendingRestoreTimerRef,
        effectRefs,
    };
}
