import { SessionId } from '@shared/types/brand';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDiffRouteNavigation } from '../useDiffRouteNavigation';
const routeMock = vi.hoisted(() => {
    let state = { location: { pathname: '/', search: {} } };
    let activeSessionId = null;
    const setLastRightSidebarPanel = vi.fn();
    return {
        navigate: vi.fn(),
        setRoute: (nextState) => {
            state = nextState;
        },
        setActiveSessionId: (nextSessionId) => {
            activeSessionId = nextSessionId;
        },
        routerState: () => state,
        chatState: () => ({ activeSessionId }),
        shellState: () => ({ setLastRightSidebarPanel }),
        setLastRightSidebarPanel,
    };
});
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => routeMock.navigate,
    useRouterState: (input) => input.select(routeMock.routerState()),
}));
vi.mock('@/features/chat/state', () => ({
    useChatStore: (selector) => selector(routeMock.chatState()),
}));
vi.mock('@/shell/ui-store', () => ({
    useUIStore: (selector) => selector(routeMock.shellState()),
}));
describe('useDiffRouteNavigation', () => {
    beforeEach(() => {
        routeMock.navigate.mockClear();
        routeMock.setLastRightSidebarPanel.mockClear();
        routeMock.setActiveSessionId(null);
        routeMock.setRoute({ location: { pathname: '/', search: {} } });
    });
    it('opens the Session Tree panel on the active session route while preserving branch search', () => {
        routeMock.setRoute({
            location: {
                pathname: '/sessions/session-1',
                search: { panel: 'diff', branch: 'branch-1', node: 'node-1' },
            },
        });
        const { result } = renderHook(() => useDiffRouteNavigation());
        act(() => result.current.toggleSessionTree());
        expect(result.current.diffOpen).toBe(true);
        expect(routeMock.setLastRightSidebarPanel).toHaveBeenCalledWith('session-tree');
        expect(routeMock.navigate).toHaveBeenCalledWith({
            to: '/sessions/$sessionId',
            params: { sessionId: 'session-1' },
            search: expect.any(Function),
        });
        const navigateCall = routeMock.navigate.mock.calls[0];
        const options = navigateCall?.[0];
        if (!options || typeof options.search !== 'function') {
            throw new Error('Expected search updater');
        }
        expect(options.search({ branch: 'branch-1', node: 'node-1', panel: 'diff' })).toEqual({
            branch: 'branch-1',
            node: 'node-1',
            diff: undefined,
            panel: 'session-tree',
        });
    });
    it('does not mutate route search outside chat routes', () => {
        routeMock.setRoute({ location: { pathname: '/settings', search: {} } });
        const { result } = renderHook(() => useDiffRouteNavigation());
        act(() => result.current.toggleDiff());
        expect(result.current.isChatRoute).toBe(false);
        expect(routeMock.navigate).not.toHaveBeenCalled();
    });
    it('opens diff on the root chat route when only an active session is known', () => {
        routeMock.setActiveSessionId(SessionId('active-session'));
        const { result } = renderHook(() => useDiffRouteNavigation());
        act(() => result.current.toggleDiff());
        expect(routeMock.navigate).toHaveBeenCalledWith({
            to: '/sessions/$sessionId',
            params: { sessionId: 'active-session' },
            search: expect.any(Function),
        });
    });
});
