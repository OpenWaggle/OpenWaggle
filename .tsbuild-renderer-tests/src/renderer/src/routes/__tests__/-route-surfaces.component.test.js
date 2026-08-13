import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/shared/ui/Button';
import { ChatRouteSurface } from '../-chat-route-surface';
import { SettingsRouteSurface } from '../-settings-route-surface';
import { SkillsRouteSurface } from '../-skills-route-surface';
const routeSurfaceMocks = vi.hoisted(() => {
    let pathname = '/settings/general';
    let lastRightSidebarPanel = 'diff';
    const setLastRightSidebarPanel = vi.fn((panel) => {
        lastRightSidebarPanel = panel;
    });
    return {
        setPathname: (nextPathname) => {
            pathname = nextPathname;
        },
        setLastPanel: (panel) => {
            lastRightSidebarPanel = panel;
        },
        routerState: () => ({ location: { pathname } }),
        shellState: () => ({ lastRightSidebarPanel, setLastRightSidebarPanel }),
        setLastRightSidebarPanel,
        chatRouteEffects: vi.fn(),
        sidePanelRefetch: vi.fn(),
    };
});
vi.mock('@tanstack/react-router', () => ({
    useRouterState: (input) => input.select(routeSurfaceMocks.routerState()),
}));
vi.mock('@/features/chat/hooks', () => ({
    useChatPanelSections: () => ({ diff: { projectPath: '/repo', onSendMessage: vi.fn() } }),
}));
vi.mock('@/features/chat/components', () => ({
    ChatPanelContent: ({ onOpenSessionTree }) => (_jsxs("main", { children: ["Chat content", _jsx(Button, { variant: "unstyled", type: "button", onClick: onOpenSessionTree, children: "Open tree" })] })),
    loadChatDiffPane: () => Promise.resolve({
        default: ({ onClose }) => (_jsxs("aside", { children: ["Diff pane", _jsx(Button, { variant: "unstyled", type: "button", onClick: onClose, children: "Close diff" })] })),
    }),
}));
vi.mock('@/features/session-tree/components', () => ({
    loadSessionTreePanel: () => Promise.resolve({
        default: ({ onClose }) => (_jsxs("aside", { children: ["Session Tree panel", _jsx(Button, { variant: "unstyled", type: "button", onClick: onClose, children: "Close tree" })] })),
    }),
}));
vi.mock('@/features/extensions', () => ({
    ExtensionSidePanelSurface: ({ target, onClose, }) => (_jsxs("aside", { children: ["Extension side panel ", target.extensionId, "/", target.sidePanelId, _jsx(Button, { variant: "unstyled", type: "button", onClick: onClose, children: "Close extension side panel" })] })),
    useExtensionSidePanelContributions: () => ({
        error: null,
        loading: false,
        projectPaths: ['/repo'],
        refetch: routeSurfaceMocks.sidePanelRefetch,
        registry: null,
    }),
}));
vi.mock('@/features/settings/components', () => ({
    AppSettingsView: ({ activeTab }) => (_jsxs("section", { children: ["Settings tab: ", activeTab] })),
}));
vi.mock('@/features/skills/components', () => ({
    SkillsPanel: () => _jsx("section", { children: "Skills panel" }),
}));
vi.mock('@/shared/ui/PanelErrorBoundary', () => ({
    PanelErrorBoundary: ({ children }) => _jsx(_Fragment, { children: children }),
}));
vi.mock('@/shared/ui/RightSidebarLayout', () => ({
    RightSidebarLayout: ({ children, onOpenChange, sidebar, }) => (_jsxs("section", { children: [children, sidebar, _jsx(Button, { variant: "unstyled", type: "button", onClick: () => onOpenChange(false), children: "Close right sidebar" })] })),
}));
vi.mock('@/shell', () => ({
    CHAT_MIN_WIDTH: 420,
    DIFF_PANEL_MAX: 900,
    DIFF_PANEL_MIN: 360,
    SETTINGS_TABS: ['general', 'waggle', 'extensions', 'mcp', 'archived', 'connections'],
    useUIStore: (selector) => selector(routeSurfaceMocks.shellState()),
}));
vi.mock('../-chat-route-effects', () => ({
    useChatRouteEffects: routeSurfaceMocks.chatRouteEffects,
}));
describe('route surfaces', () => {
    beforeEach(() => {
        routeSurfaceMocks.setPathname('/settings/general');
        routeSurfaceMocks.setLastPanel('diff');
        routeSurfaceMocks.setLastRightSidebarPanel.mockClear();
        routeSurfaceMocks.chatRouteEffects.mockClear();
        routeSurfaceMocks.sidePanelRefetch.mockClear();
    });
    it('derives the settings tab from the current route when the route contains a tab segment', () => {
        routeSurfaceMocks.setPathname('/settings/extensions');
        render(_jsx(SettingsRouteSurface, { tab: "general" }));
        expect(screen.getByText('Settings tab: extensions')).toBeInTheDocument();
    });
    it('falls back to the route-provided settings tab for non-tab paths', () => {
        routeSurfaceMocks.setPathname('/settings/unknown');
        render(_jsx(SettingsRouteSurface, { tab: "waggle" }));
        expect(screen.getByText('Settings tab: waggle')).toBeInTheDocument();
    });
    it('wraps the skills panel in its route surface', () => {
        render(_jsx(SkillsRouteSurface, {}));
        expect(screen.getByText('Skills panel')).toBeInTheDocument();
    });
    it('renders chat content with the active diff sidebar and closes it through route state', async () => {
        const onDiffOpenChange = vi.fn();
        const onSessionTreeOpenChange = vi.fn();
        render(_jsx(ChatRouteSurface, { workspace: { branchId: 'branch-1', nodeId: 'node-1', sessionId: 'session-1' }, rightSidebar: { diffOpen: true, extensionSidePanel: null, sessionTreeOpen: false }, rightSidebarActions: {
                onDiffOpenChange,
                onExtensionSidePanelOpenChange: vi.fn(),
                onSessionTreeOpenChange,
            } }));
        expect(screen.getByText('Chat content')).toBeInTheDocument();
        expect(await screen.findByText('Diff pane')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close right sidebar' }));
        expect(routeSurfaceMocks.chatRouteEffects).toHaveBeenCalledWith({
            branchId: 'branch-1',
            diffOpen: true,
            nodeId: 'node-1',
            sessionId: 'session-1',
        });
        expect(routeSurfaceMocks.setLastRightSidebarPanel).toHaveBeenCalledWith('diff');
        expect(onDiffOpenChange).toHaveBeenCalledWith(false);
        expect(onSessionTreeOpenChange).not.toHaveBeenCalled();
    });
    it('renders Session Tree when that panel is open and routes close events to the tree toggle', async () => {
        const onDiffOpenChange = vi.fn();
        const onSessionTreeOpenChange = vi.fn();
        render(_jsx(ChatRouteSurface, { workspace: { branchId: null, nodeId: null, sessionId: 'session-1' }, rightSidebar: { diffOpen: false, extensionSidePanel: null, sessionTreeOpen: true }, rightSidebarActions: {
                onDiffOpenChange,
                onExtensionSidePanelOpenChange: vi.fn(),
                onSessionTreeOpenChange,
            } }));
        expect(await screen.findByText('Session Tree panel')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close right sidebar' }));
        expect(routeSurfaceMocks.setLastRightSidebarPanel).toHaveBeenCalledWith('session-tree');
        expect(onSessionTreeOpenChange).toHaveBeenCalledWith(false);
        expect(onDiffOpenChange).not.toHaveBeenCalled();
    });
    it('renders extension side panels from route state and routes close events to extension search', async () => {
        const onDiffOpenChange = vi.fn();
        const onSessionTreeOpenChange = vi.fn();
        const onExtensionSidePanelOpenChange = vi.fn();
        render(_jsx(ChatRouteSurface, { workspace: { branchId: null, nodeId: null, sessionId: 'session-1' }, rightSidebar: {
                diffOpen: false,
                extensionSidePanel: {
                    extensionId: 'sample-extension',
                    sidePanelId: 'sample.side-panel',
                },
                sessionTreeOpen: false,
            }, rightSidebarActions: {
                onDiffOpenChange,
                onExtensionSidePanelOpenChange,
                onSessionTreeOpenChange,
            } }));
        expect(await screen.findByText('Extension side panel sample-extension/sample.side-panel')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close right sidebar' }));
        expect(routeSurfaceMocks.setLastRightSidebarPanel).toHaveBeenCalledWith({
            kind: 'extension-side-panel',
            extensionId: 'sample-extension',
            sidePanelId: 'sample.side-panel',
        });
        expect(onExtensionSidePanelOpenChange).toHaveBeenCalledWith(false, {
            extensionId: 'sample-extension',
            sidePanelId: 'sample.side-panel',
        });
        expect(onDiffOpenChange).not.toHaveBeenCalled();
        expect(onSessionTreeOpenChange).not.toHaveBeenCalled();
    });
});
