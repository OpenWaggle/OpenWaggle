import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { RightSidebarDockedLayout } from './RightSidebarDockedLayout';
import { RightSidebarResizeRail } from './RightSidebarResizeRail';
import { RightSidebarSheet } from './RightSidebarSheet';
import { clampWidth, persistWidth, pixelValue, readStoredWidth, sidebarWidthValue, } from './right-sidebar-layout-sizing';
export { sidebarWidthValue } from './right-sidebar-layout-sizing';
function useStoredSidebarWidth({ defaultWidth, maxWidth, minWidth, storageKey, }) {
    const [width, setWidth] = useState(() => clampWidth(readStoredWidth(storageKey, defaultWidth), minWidth, maxWidth));
    const widthRef = useRef(width);
    function commitWidth(nextWidth) {
        const clampedWidth = clampWidth(nextWidth, minWidth, maxWidth);
        widthRef.current = clampedWidth;
        setWidth(clampedWidth);
        persistWidth(storageKey, clampedWidth);
    }
    return { commitWidth, setWidth, width, widthRef };
}
export function RightSidebarLayout({ children, open, sizing, sidebar, onOpenChange, shouldAcceptWidth, }) {
    const { defaultWidth, mainMinWidth, maxWidth, minWidth, sheetBreakpointPx, storageKey } = sizing;
    const rootRef = useRef(null);
    const mainRef = useRef(null);
    const sidebarRef = useRef(null);
    const panelRef = useRef(null);
    const [hasOpened, setHasOpened] = useState(false);
    const { commitWidth, width, widthRef } = useStoredSidebarWidth({
        defaultWidth,
        maxWidth,
        minWidth,
        storageKey,
    });
    const isSheet = useMediaQuery(`(max-width: ${String(sheetBreakpointPx)}px)`);
    const shouldRenderSidebar = hasOpened || open;
    useEffect(() => {
        widthRef.current = width;
        sidebarRef.current?.style.setProperty('width', open ? sidebarWidthValue(width, mainMinWidth) : pixelValue(0));
        panelRef.current?.style.setProperty('width', '100%');
    }, [mainMinWidth, open, width, widthRef]);
    useEffect(() => {
        const panel = panelRef.current;
        const activeElement = document.activeElement;
        if (open || !panel || !activeElement || !panel.contains(activeElement))
            return;
        mainRef.current?.focus({ preventScroll: true });
    }, [open]);
    function captureSidebar(node) {
        sidebarRef.current = node;
        if (node && open)
            setHasOpened(true);
    }
    function captureRoot(node) {
        rootRef.current = node;
    }
    function captureMain(node) {
        mainRef.current = node;
    }
    function capturePanel(node) {
        panelRef.current = node;
    }
    function applyWidth(nextWidth) {
        widthRef.current = nextWidth;
        sidebarRef.current?.style.setProperty('width', sidebarWidthValue(nextWidth, mainMinWidth));
        panelRef.current?.style.setProperty('width', '100%');
    }
    if (isSheet) {
        return (_jsxs(_Fragment, { children: [children, shouldRenderSidebar ? (_jsx(RightSidebarSheet, { open: open, onOpenChange: onOpenChange, children: sidebar })) : null] }));
    }
    return (_jsx(RightSidebarDockedLayout, { captures: { captureMain, capturePanel, captureRoot }, content: { children, sidebar }, rail: _jsx(RightSidebarResizeRail, { actions: { applyWidth, commitWidth }, bounds: { maxWidth, mainMinWidth, minWidth }, handles: { panel: panelRef, root: rootRef, sidebar: sidebarRef, width: widthRef }, state: { open, width }, shouldAcceptWidth: shouldAcceptWidth }), shell: { mainMinWidth, open, shouldRenderSidebar, width, captureSidebar } }));
}
