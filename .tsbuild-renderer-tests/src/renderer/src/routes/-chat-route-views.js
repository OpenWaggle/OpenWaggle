import { jsx as _jsx } from "react/jsx-runtime";
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { EXTENSION_SIDE_PANEL_ROUTE_PANEL } from '@/shell/ui-store';
import { extensionSidePanelTargetFromSearch, } from './-route-search';
const LazyChatRouteSurface = lazy(() => import('./-chat-route-surface').then((module) => ({
    default: module.ChatRouteSurface,
})));
function ChatRouteSurfaceFallback() {
    return (_jsx("output", { "aria-live": "polite", className: "flex min-h-0 min-w-0 flex-1 items-center justify-center bg-bg text-[13px] text-text-tertiary", children: "Loading chat\u2026" }));
}
export function ChatIndexRouteView() {
    const navigate = useNavigate();
    const search = useSearch({ from: '/_chat/' });
    const diffOpen = search.panel === 'diff' || (search.diff === 1 && search.panel === undefined);
    const sessionTreeOpen = search.panel === 'session-tree';
    const extensionSidePanel = extensionSidePanelTargetFromSearch(search);
    function setDiffOpen(open) {
        const panel = open ? 'diff' : undefined;
        void navigate({
            to: '/',
            search: {
                diff: undefined,
                panel,
                sidePanelExtensionId: undefined,
                sidePanelId: undefined,
                sidePanelPackagePath: undefined,
                sidePanelContentHash: undefined,
            },
        });
    }
    function setSessionTreeOpen(open) {
        const panel = open ? 'session-tree' : undefined;
        void navigate({
            to: '/',
            search: {
                diff: undefined,
                panel,
                sidePanelExtensionId: undefined,
                sidePanelId: undefined,
                sidePanelPackagePath: undefined,
                sidePanelContentHash: undefined,
            },
        });
    }
    function setExtensionSidePanelOpen(open, target) {
        void navigate({
            to: '/',
            search: {
                diff: undefined,
                panel: open ? EXTENSION_SIDE_PANEL_ROUTE_PANEL : undefined,
                sidePanelExtensionId: open ? target.extensionId : undefined,
                sidePanelId: open ? target.sidePanelId : undefined,
                sidePanelPackagePath: open ? target.packagePath : undefined,
                sidePanelContentHash: open ? target.contentHash : undefined,
            },
        });
    }
    return (_jsx(Suspense, { fallback: _jsx(ChatRouteSurfaceFallback, {}), children: _jsx(LazyChatRouteSurface, { workspace: { branchId: null, nodeId: null, sessionId: null }, rightSidebar: { diffOpen, extensionSidePanel, sessionTreeOpen }, rightSidebarActions: {
                onDiffOpenChange: setDiffOpen,
                onExtensionSidePanelOpenChange: setExtensionSidePanelOpen,
                onSessionTreeOpenChange: setSessionTreeOpen,
            } }) }));
}
export function ChatSessionRouteView() {
    const navigate = useNavigate();
    const { sessionId } = useParams({ from: '/sessions/$sessionId' });
    const search = useSearch({ from: '/sessions/$sessionId' });
    const diffOpen = search.panel === 'diff' || (search.diff === 1 && search.panel === undefined);
    const sessionTreeOpen = search.panel === 'session-tree';
    const extensionSidePanel = extensionSidePanelTargetFromSearch(search);
    function setDiffOpen(open) {
        const panel = open ? 'diff' : undefined;
        void navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
            search: (previous) => ({
                ...previous,
                diff: undefined,
                panel,
                sidePanelExtensionId: undefined,
                sidePanelId: undefined,
                sidePanelPackagePath: undefined,
                sidePanelContentHash: undefined,
            }),
        });
    }
    function setSessionTreeOpen(open) {
        const panel = open ? 'session-tree' : undefined;
        void navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
            search: (previous) => ({
                ...previous,
                diff: undefined,
                panel,
                sidePanelExtensionId: undefined,
                sidePanelId: undefined,
                sidePanelPackagePath: undefined,
                sidePanelContentHash: undefined,
            }),
        });
    }
    function setExtensionSidePanelOpen(open, target) {
        const panel = open ? EXTENSION_SIDE_PANEL_ROUTE_PANEL : undefined;
        void navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
            search: (previous) => ({
                ...previous,
                diff: undefined,
                panel,
                sidePanelExtensionId: open ? target.extensionId : undefined,
                sidePanelId: open ? target.sidePanelId : undefined,
                sidePanelPackagePath: open ? target.packagePath : undefined,
                sidePanelContentHash: open ? target.contentHash : undefined,
            }),
        });
    }
    return (_jsx(Suspense, { fallback: _jsx(ChatRouteSurfaceFallback, {}), children: _jsx(LazyChatRouteSurface, { workspace: { branchId: search.branch ?? null, nodeId: search.node ?? null, sessionId }, rightSidebar: { diffOpen, extensionSidePanel, sessionTreeOpen }, rightSidebarActions: {
                onDiffOpenChange: setDiffOpen,
                onExtensionSidePanelOpenChange: setExtensionSidePanelOpen,
                onSessionTreeOpenChange: setSessionTreeOpen,
            } }) }));
}
