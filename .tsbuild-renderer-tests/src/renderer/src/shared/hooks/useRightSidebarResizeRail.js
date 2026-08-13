import { useEffect, useRef } from 'react';
import { clampedVisibleWidth, clampWidth, RESIZE_BODY_CLASS, RESIZE_MOVE_THRESHOLD_PX, RESIZE_RAIL_HALF_WIDTH_PX, resizeRailRightValue, } from '@/shared/ui/right-sidebar-layout-sizing';
export function useRightSidebarResizeRail({ actions, bounds, refs, state, shouldAcceptWidth, }) {
    const resizeStateRef = useRef(null);
    const suppressClickRef = useRef(false);
    function cleanupResizeState(pointerId) {
        const resizeState = resizeStateRef.current;
        if (!resizeState)
            return;
        const nextStoredWidth = resizeState.moved ? resizeState.width : state.width;
        resizeStateRef.current = null;
        if (resizeState.rafId !== null)
            window.cancelAnimationFrame(resizeState.rafId);
        resizeState.panel.style.removeProperty('transition-duration');
        resizeState.rail.style.removeProperty('transition-duration');
        resizeState.sidebar.style.removeProperty('transition-duration');
        resizeState.rail.style.setProperty('right', resizeRailRightValue(state.open, nextStoredWidth, bounds.mainMinWidth));
        actions.applyWidth(nextStoredWidth);
        document.body.classList.remove(RESIZE_BODY_CLASS);
        if (resizeState.rail.hasPointerCapture(pointerId))
            resizeState.rail.releasePointerCapture(pointerId);
        if (resizeState.moved)
            actions.commitWidth(nextStoredWidth);
    }
    function handlePointerDown(event) {
        if (!state.open || event.button !== 0)
            return;
        const panel = refs.panel.current;
        const root = refs.root.current;
        const sidebar = refs.sidebar.current;
        if (!panel || !root || !sidebar)
            return;
        event.preventDefault();
        event.stopPropagation();
        const startWidth = clampedVisibleWidth(refs.width.current, bounds.minWidth, bounds.maxWidth, root.clientWidth, bounds.mainMinWidth);
        panel.style.setProperty('transition-duration', '0ms');
        panel.style.setProperty('width', '100%');
        sidebar.style.setProperty('transition-duration', '0ms');
        sidebar.style.setProperty('width', `${String(startWidth)}px`);
        event.currentTarget.style.setProperty('transition-duration', '0ms');
        event.currentTarget.style.setProperty('right', `${String(startWidth - RESIZE_RAIL_HALF_WIDTH_PX)}px`);
        document.body.classList.add(RESIZE_BODY_CLASS);
        resizeStateRef.current = {
            moved: false,
            panel,
            pendingWidth: startWidth,
            pointerId: event.pointerId,
            rafId: null,
            rail: event.currentTarget,
            root,
            sidebar,
            startWidth,
            startX: event.clientX,
            width: startWidth,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    function applyPendingResize() {
        const activeState = resizeStateRef.current;
        if (!activeState)
            return;
        activeState.rafId = null;
        const nextWidth = activeState.pendingWidth;
        const accepted = shouldAcceptWidth?.({
            nextWidth,
            panel: activeState.panel,
            root: activeState.root,
            sidebar: activeState.sidebar,
        }) ?? true;
        if (!accepted)
            return;
        activeState.width = nextWidth;
        activeState.rail.style.setProperty('right', `${String(nextWidth - RESIZE_RAIL_HALF_WIDTH_PX)}px`);
        actions.applyWidth(nextWidth);
    }
    function handlePointerMove(event) {
        const resizeState = resizeStateRef.current;
        if (!resizeState || resizeState.pointerId !== event.pointerId)
            return;
        event.preventDefault();
        const delta = resizeState.startX - event.clientX;
        if (Math.abs(delta) > RESIZE_MOVE_THRESHOLD_PX)
            resizeState.moved = true;
        resizeState.pendingWidth = clampWidth(resizeState.startWidth + delta, bounds.minWidth, bounds.maxWidth);
        if (resizeState.rafId !== null)
            return;
        resizeState.rafId = window.requestAnimationFrame(applyPendingResize);
    }
    function endResize(event) {
        const resizeState = resizeStateRef.current;
        if (!resizeState || resizeState.pointerId !== event.pointerId)
            return;
        event.preventDefault();
        suppressClickRef.current = resizeState.moved;
        cleanupResizeState(event.pointerId);
    }
    useEffect(() => {
        return () => {
            const resizeState = resizeStateRef.current;
            if (!resizeState)
                return;
            if (resizeState.rafId !== null)
                window.cancelAnimationFrame(resizeState.rafId);
            resizeState.panel.style.removeProperty('transition-duration');
            resizeState.rail.style.removeProperty('transition-duration');
            resizeState.sidebar.style.removeProperty('transition-duration');
            document.body.classList.remove(RESIZE_BODY_CLASS);
        };
    }, []);
    return {
        cleanupResizeState,
        endResize,
        handleClick(event) {
            if (!suppressClickRef.current)
                return;
            suppressClickRef.current = false;
            event.preventDefault();
        },
        handlePointerDown,
        handlePointerMove,
    };
}
