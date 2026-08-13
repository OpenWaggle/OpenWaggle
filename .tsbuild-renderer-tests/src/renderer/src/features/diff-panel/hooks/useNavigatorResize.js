import { useCallback, useEffect, useRef, useState } from 'react';
const PARSE_RADIX = 10;
const STORAGE_KEY = 'openwaggle:changed-file-navigator-width:v1';
const DEFAULT_WIDTH = 220;
const MIN_WIDTH = 140;
const MAX_WIDTH = 480;
function readStoredWidth() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null)
            return DEFAULT_WIDTH;
        const parsed = Number.parseInt(raw, PARSE_RADIX);
        if (Number.isNaN(parsed))
            return DEFAULT_WIDTH;
        return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
    }
    catch {
        // Private mode or a disabled store is not worth failing a render over.
        return DEFAULT_WIDTH;
    }
}
/**
 * Width of the Changed-file navigator, draggable and persisted.
 *
 * Deliberately local rather than reusing useRightSidebarResizeRail: that hook is
 * typed and positioned for the app-level right sidebar (absolute inset rail,
 * main-content min-width coupling), so reusing it would mean generalising it
 * first. This is the smaller half of that work, kept until a second caller earns
 * the abstraction.
 */
export function useNavigatorResize() {
    const [width, setWidth] = useState(readStoredWidth);
    const [isResizing, setIsResizing] = useState(false);
    const frameRef = useRef(null);
    const pendingWidthRef = useRef(width);
    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY, String(width));
        }
        catch {
            // Persistence is a convenience; a failure must not break resizing.
        }
    }, [width]);
    const stopResizing = useCallback(() => setIsResizing(false), []);
    useEffect(() => {
        if (!isResizing)
            return;
        // Dragging leftwards widens the navigator, because it is docked on the right.
        function onPointerMove(event) {
            pendingWidthRef.current = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - event.clientX));
            if (frameRef.current !== null)
                return;
            frameRef.current = window.requestAnimationFrame(() => {
                frameRef.current = null;
                setWidth(pendingWidthRef.current);
            });
        }
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', stopResizing);
        window.addEventListener('pointercancel', stopResizing);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', stopResizing);
            window.removeEventListener('pointercancel', stopResizing);
            if (frameRef.current !== null) {
                window.cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };
    }, [isResizing, stopResizing]);
    /** Keyboard resizing, so the rail is not pointer-only. */
    const nudge = useCallback((delta) => {
        setWidth((current) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, current + delta)));
    }, []);
    return {
        width,
        isResizing,
        startResizing: useCallback(() => setIsResizing(true), []),
        nudge,
        minWidth: MIN_WIDTH,
        maxWidth: MAX_WIDTH,
    };
}
