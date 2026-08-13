import { jsx as _jsx } from "react/jsx-runtime";
import { SessionId } from '@shared/types/brand';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsView } from '../AppSettingsView';
import { SettingsNav } from '../SettingsNav';
import { SettingsPage } from '../SettingsPage';
const { navigateMock, fullscreenMock, chatMock } = vi.hoisted(() => ({
    navigateMock: vi.fn(),
    fullscreenMock: vi.fn(),
    chatMock: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateMock,
}));
vi.mock('@/features/chat/hooks', () => ({
    useChat: () => chatMock(),
}));
vi.mock('@/shell/useFullscreen', () => ({
    useFullscreen: () => fullscreenMock(),
}));
vi.mock('../sections/GeneralSection', () => ({ GeneralSection: () => _jsx("div", { children: "General settings" }) }));
vi.mock('../sections/WaggleSection', () => ({ WaggleSection: () => _jsx("div", { children: "Waggle settings" }) }));
vi.mock('../sections/ExtensionsSection', () => ({
    ExtensionsSection: () => _jsx("div", { children: "Extensions settings" }),
}));
vi.mock('../sections/McpSection', () => ({ McpSection: () => _jsx("div", { children: "MCP settings" }) }));
vi.mock('../sections/ConnectionsSection', () => ({
    ConnectionsSection: () => _jsx("div", { children: "Connections settings" }),
}));
vi.mock('../sections/ArchivedSection', () => ({
    ArchivedSection: () => _jsx("div", { children: "Archived settings" }),
}));
describe('settings shell components', () => {
    beforeEach(() => {
        navigateMock.mockReset();
        fullscreenMock.mockReturnValue(false);
        chatMock.mockReturnValue({ activeSessionId: null });
    });
    it('navigates between active settings tabs and omits inactive placeholders', () => {
        render(_jsx(SettingsNav, { activeTab: "general" }));
        fireEvent.click(screen.getByRole('button', { name: /Waggle Mode/ }));
        fireEvent.click(screen.getByRole('button', { name: /Extensions/ }));
        fireEvent.click(screen.getByRole('button', { name: /General/ }));
        expect(screen.queryByRole('button', { name: /Git/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Worktrees/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Personalization/ })).not.toBeInTheDocument();
        expect(navigateMock).toHaveBeenNthCalledWith(1, {
            to: '/settings/$tab',
            params: { tab: 'waggle' },
        });
        expect(navigateMock).toHaveBeenNthCalledWith(2, {
            to: '/settings/$tab',
            params: { tab: 'extensions' },
        });
        expect(navigateMock).toHaveBeenNthCalledWith(3, { to: '/settings' });
    });
    it('keeps active and inactive nav items in the same layout position', () => {
        render(_jsx(SettingsNav, { activeTab: "extensions" }));
        const activeItem = screen.getByRole('button', { name: /Extensions/ });
        const inactiveItem = screen.getByRole('button', { name: /Waggle Mode/ });
        expect(activeItem).toHaveClass('w-full', 'justify-start');
        expect(inactiveItem).toHaveClass('w-full', 'justify-start');
    });
    it('routes back to the active session from the settings page header', () => {
        chatMock.mockReturnValue({ activeSessionId: SessionId('session-1') });
        render(_jsx(SettingsPage, { activeTab: "connections" }));
        fireEvent.click(screen.getByRole('button', { name: /Back to app/ }));
        expect(screen.getByText('Connections settings')).toBeInTheDocument();
        expect(navigateMock).toHaveBeenCalledWith({
            to: '/sessions/$sessionId',
            params: { sessionId: 'session-1' },
        });
    });
    it('renders AppSettingsView through the panel boundary', () => {
        render(_jsx(AppSettingsView, { activeTab: "mcp" }));
        expect(screen.getByText('MCP settings')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });
});
