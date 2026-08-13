import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/shared/ui/Button';
import { FeedbackButton } from '../HeaderFeedbackButton';
import { useUIStore } from '../ui-store';
import { useFullscreen } from '../useFullscreen';
import { WorkspaceShell } from '../WorkspaceShell';
import { WorkspaceTerminal } from '../WorkspaceTerminal';
const shellMocks = vi.hoisted(() => {
    let fullscreenHandler = null;
    const unsubscribeFullscreen = vi.fn();
    return {
        backgroundRunMonitor: vi.fn(),
        autoUpdater: vi.fn(),
        getFullscreenHandler: () => fullscreenHandler,
        projectPath: '/repo',
        unsubscribeFullscreen,
        workspaceLifecycle: vi.fn(),
        onFullscreenChanged: vi.fn((handler) => {
            fullscreenHandler = handler;
            return unsubscribeFullscreen;
        }),
    };
});
vi.mock('@/features/chat/hooks', () => ({
    useBackgroundRunMonitor: () => shellMocks.backgroundRunMonitor(),
}));
vi.mock('@/features/feedback/components', () => ({
    FeedbackModal: () => _jsx("div", { children: "Feedback modal" }),
}));
vi.mock('@/features/sessions/hooks', () => ({
    useProject: () => ({ projectPath: shellMocks.projectPath }),
}));
vi.mock('@/features/sidebar/components', () => ({
    Sidebar: () => _jsx("aside", { children: "Sidebar" }),
}));
vi.mock('@/features/terminal/components', () => ({
    TerminalPanel: ({ projectPath, onClose, }) => (_jsxs("section", { children: ["Terminal for ", projectPath ?? 'none', _jsx(Button, { variant: "unstyled", type: "button", onClick: onClose, children: "Close terminal" })] })),
}));
vi.mock('@/shared/lib/ipc', () => ({
    api: {
        onFullscreenChanged: shellMocks.onFullscreenChanged,
    },
}));
vi.mock('../Header', () => ({ Header: () => _jsx("header", { children: "Header" }) }));
vi.mock('../ToastOverlay', () => ({ ToastOverlay: () => _jsx("div", { children: "Toasts" }) }));
vi.mock('../useAutoUpdater', () => ({ useAutoUpdater: () => shellMocks.autoUpdater() }));
vi.mock('../useWorkspaceLifecycle', () => ({
    useWorkspaceLifecycle: () => shellMocks.workspaceLifecycle(),
}));
describe('shell surfaces', () => {
    beforeEach(() => {
        useUIStore.setState({ feedbackModalOpen: false, terminalOpen: false });
        shellMocks.backgroundRunMonitor.mockClear();
        shellMocks.autoUpdater.mockClear();
        shellMocks.workspaceLifecycle.mockClear();
        shellMocks.onFullscreenChanged.mockClear();
        shellMocks.unsubscribeFullscreen.mockClear();
    });
    it('opens the feedback callback from the header button without forwarding the click event', () => {
        const onOpen = vi.fn();
        render(_jsx(FeedbackButton, { onOpen: onOpen }));
        fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }));
        expect(onOpen).toHaveBeenCalledOnce();
        // openFeedbackModal takes an optional AgentErrorInfo. Forwarding the click
        // event made it a truthy non-error object and crashed the modal.
        expect(onOpen).toHaveBeenCalledWith();
    });
    it('mounts workspace chrome, lifecycle hooks, terminal, and feedback modal from store state', () => {
        useUIStore.setState({ feedbackModalOpen: true, terminalOpen: true });
        render(_jsx(WorkspaceShell, { children: _jsx("main", { children: "Route content" }) }));
        expect(screen.getByText('Sidebar')).toBeInTheDocument();
        expect(screen.getByText('Header')).toBeInTheDocument();
        expect(screen.getByText('Route content')).toBeInTheDocument();
        expect(screen.getByText('Terminal for /repo')).toBeInTheDocument();
        expect(screen.getByText('Feedback modal')).toBeInTheDocument();
        expect(shellMocks.workspaceLifecycle).toHaveBeenCalledOnce();
        expect(shellMocks.backgroundRunMonitor).toHaveBeenCalledOnce();
        expect(shellMocks.autoUpdater).toHaveBeenCalledOnce();
    });
    it('closes the workspace terminal through the terminal panel close action', () => {
        useUIStore.setState({ terminalOpen: true });
        render(_jsx(WorkspaceTerminal, {}));
        fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }));
        expect(useUIStore.getState().terminalOpen).toBe(false);
    });
    it('tracks fullscreen state from the preload event subscription and cleans up on unmount', () => {
        const { result, unmount } = renderHook(() => useFullscreen());
        const fullscreenHandler = shellMocks.getFullscreenHandler();
        if (!fullscreenHandler) {
            throw new Error('Expected fullscreen handler to be registered');
        }
        act(() => fullscreenHandler(true));
        expect(result.current).toBe(true);
        unmount();
        expect(shellMocks.unsubscribeFullscreen).toHaveBeenCalledOnce();
    });
});
