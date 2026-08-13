import { jsx as _jsx } from "react/jsx-runtime";
import { lazy, Suspense } from 'react';
import { ChatPanelContent, loadChatDiffPane } from '@/features/chat/components';
import { useChatPanelSections } from '@/features/chat/hooks';
import { ExtensionSidePanelSurface, useExtensionSidePanelContributions, } from '@/features/extensions';
import { loadSessionTreePanel } from '@/features/session-tree/components';
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary';
import { RightSidebarLayout } from '@/shared/ui/RightSidebarLayout';
import { CHAT_MIN_WIDTH, DIFF_PANEL_MAX, DIFF_PANEL_MIN, useUIStore } from '@/shell';
import { useChatRouteEffects } from './-chat-route-effects';
import { isExtensionRightSidebarPanel, resolveRightSidebarPanel } from './-right-sidebar-panel';
const DIFF_PANEL_DEFAULT_WIDTH = 600;
const DIFF_PANEL_STORAGE_KEY = 'openwaggle:diff-sidebar-width';
const DIFF_PANEL_SHEET_BREAKPOINT_PX = 1180;
const OVERFLOW_TOLERANCE_PX = 0.5;
const LazyChatDiffPane = lazy(loadChatDiffPane);
const LazySessionTreePanel = lazy(loadSessionTreePanel);
function DiffSidebarFallback() {
    return (_jsx("output", { className: "flex size-full items-center justify-center bg-diff-bg text-[13px] text-text-tertiary", "aria-live": "polite", children: "Loading diff\u2026" }));
}
function shouldAcceptDiffWidth(input) {
    const previousPanelWidth = input.panel.style.width;
    const previousSidebarWidth = input.sidebar.style.width;
    input.panel.style.setProperty('width', `${String(input.nextWidth)}px`);
    input.sidebar.style.setProperty('width', `${String(input.nextWidth)}px`);
    const mainWidth = input.root.clientWidth - input.nextWidth;
    const composerForm = input.root.querySelector('[data-chat-composer-form="true"]');
    const composerFits = composerForm
        ? composerForm.scrollWidth <= composerForm.clientWidth + OVERFLOW_TOLERANCE_PX
        : true;
    const accepted = mainWidth >= CHAT_MIN_WIDTH && composerFits;
    restoreInlineWidth(input.panel, previousPanelWidth);
    restoreInlineWidth(input.sidebar, previousSidebarWidth);
    return accepted;
}
function restoreInlineWidth(element, previousWidth) {
    if (previousWidth.length > 0) {
        element.style.setProperty('width', previousWidth);
        return;
    }
    element.style.removeProperty('width');
}
export function ChatRouteSurface({ workspace, rightSidebar, rightSidebarActions, }) {
    const sections = useChatPanelSections();
    const lastRightSidebarPanel = useUIStore((state) => state.lastRightSidebarPanel);
    const setLastRightSidebarPanel = useUIStore((state) => state.setLastRightSidebarPanel);
    const renderedRightSidebarPanel = resolveRightSidebarPanel({
        diffOpen: rightSidebar.diffOpen,
        extensionSidePanel: rightSidebar.extensionSidePanel,
        lastPanel: lastRightSidebarPanel,
        sessionTreeOpen: rightSidebar.sessionTreeOpen,
    });
    const sidePanelQuery = useExtensionSidePanelContributions({
        enabled: isExtensionRightSidebarPanel(renderedRightSidebarPanel),
        projectPath: sections.diff.projectPath,
        sessionId: workspace.sessionId,
    });
    useChatRouteEffects({
        branchId: workspace.branchId,
        diffOpen: rightSidebar.diffOpen,
        nodeId: workspace.nodeId,
        sessionId: workspace.sessionId,
    });
    function handleDiffOpenChange(open) {
        setLastRightSidebarPanel('diff');
        rightSidebarActions.onDiffOpenChange(open);
    }
    function handleSessionTreeOpenChange(open) {
        setLastRightSidebarPanel('session-tree');
        rightSidebarActions.onSessionTreeOpenChange(open);
    }
    function handleExtensionSidePanelOpenChange(open, target) {
        const routeTarget = {
            extensionId: target.extensionId,
            sidePanelId: target.sidePanelId,
            ...(target.packagePath ? { packagePath: target.packagePath } : {}),
            ...(target.contentHash ? { contentHash: target.contentHash } : {}),
        };
        setLastRightSidebarPanel({
            kind: 'extension-side-panel',
            extensionId: routeTarget.extensionId,
            sidePanelId: routeTarget.sidePanelId,
            ...(routeTarget.packagePath ? { packagePath: routeTarget.packagePath } : {}),
            ...(routeTarget.contentHash ? { contentHash: routeTarget.contentHash } : {}),
        });
        rightSidebarActions.onExtensionSidePanelOpenChange(open, routeTarget);
    }
    return (_jsx("div", { className: "flex min-h-0 min-w-0 flex-1 overflow-hidden", children: _jsx(PanelErrorBoundary, { name: "Chat", className: "flex min-w-0 flex-1 overflow-hidden", children: _jsx(RightSidebarLayout, { open: rightSidebar.diffOpen ||
                    rightSidebar.sessionTreeOpen ||
                    rightSidebar.extensionSidePanel !== null, sizing: {
                    defaultWidth: DIFF_PANEL_DEFAULT_WIDTH,
                    mainMinWidth: CHAT_MIN_WIDTH,
                    maxWidth: DIFF_PANEL_MAX,
                    minWidth: DIFF_PANEL_MIN,
                    sheetBreakpointPx: DIFF_PANEL_SHEET_BREAKPOINT_PX,
                    storageKey: DIFF_PANEL_STORAGE_KEY,
                }, onOpenChange: (open) => {
                    if (renderedRightSidebarPanel === 'diff') {
                        handleDiffOpenChange(open);
                        return;
                    }
                    if (isExtensionRightSidebarPanel(renderedRightSidebarPanel)) {
                        handleExtensionSidePanelOpenChange(open, renderedRightSidebarPanel);
                        return;
                    }
                    handleSessionTreeOpenChange(open);
                }, shouldAcceptWidth: shouldAcceptDiffWidth, sidebar: _jsx(Suspense, { fallback: _jsx(DiffSidebarFallback, {}), children: renderedRightSidebarPanel === 'session-tree' ? (_jsx(LazySessionTreePanel, { onClose: () => handleSessionTreeOpenChange(false) })) : isExtensionRightSidebarPanel(renderedRightSidebarPanel) ? (_jsx(ExtensionSidePanelSurface, { error: sidePanelQuery.error?.message ?? null, loading: sidePanelQuery.loading, onClose: () => handleExtensionSidePanelOpenChange(false, renderedRightSidebarPanel), onRefresh: () => void sidePanelQuery.refetch(), projectPaths: sidePanelQuery.projectPaths, registry: sidePanelQuery.registry, target: renderedRightSidebarPanel })) : (_jsx(LazyChatDiffPane, { section: sections.diff, onClose: () => handleDiffOpenChange(false) })) }), children: _jsx(ChatPanelContent, { sections: sections, onOpenSessionTree: () => handleSessionTreeOpenChange(true) }) }) }) }));
}
