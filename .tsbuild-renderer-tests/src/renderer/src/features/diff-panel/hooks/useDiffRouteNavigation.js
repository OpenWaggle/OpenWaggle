import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useChatStore } from '@/features/chat/state';
import { useUIStore } from '@/shell/ui-store';
function isChatPath(pathname) {
    return pathname === '/' || pathname.startsWith('/sessions/');
}
function routeSessionId(pathname) {
    if (!pathname.startsWith('/sessions/')) {
        return null;
    }
    const [, sessionsSegment, sessionId] = pathname.split('/');
    return sessionsSegment === 'sessions' && sessionId ? sessionId : null;
}
export function useDiffRouteNavigation() {
    const navigate = useNavigate();
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const rightPanel = useRouterState({
        select: (state) => {
            if (state.location.search.panel === 'session-tree') {
                return 'session-tree';
            }
            if (state.location.search.panel === 'diff' || state.location.search.diff === 1) {
                return 'diff';
            }
            return null;
        },
    });
    const activeSessionId = useChatStore((state) => state.activeSessionId);
    const setLastRightSidebarPanel = useUIStore((state) => state.setLastRightSidebarPanel);
    const isChatRoute = isChatPath(pathname);
    const currentRouteSessionId = routeSessionId(pathname);
    const targetSessionId = currentRouteSessionId ?? (activeSessionId ? String(activeSessionId) : null);
    const diffOpen = rightPanel === 'diff';
    const sessionTreeOpen = rightPanel === 'session-tree';
    function setRightPanel(panel) {
        if (!isChatRoute) {
            return;
        }
        const panelToRemember = panel ?? rightPanel;
        if (panelToRemember !== null) {
            setLastRightSidebarPanel(panelToRemember);
        }
        const panelSearchValue = panel ?? undefined;
        if (targetSessionId) {
            void navigate({
                to: '/sessions/$sessionId',
                params: { sessionId: targetSessionId },
                search: (previous) => ({
                    ...(currentRouteSessionId ? { branch: previous.branch, node: previous.node } : {}),
                    diff: undefined,
                    panel: panelSearchValue,
                }),
            });
            return;
        }
        void navigate({
            to: '/',
            search: { diff: undefined, panel: panelSearchValue },
        });
    }
    function setDiffOpen(open) {
        setRightPanel(open ? 'diff' : null);
    }
    function setSessionTreeOpen(open) {
        setRightPanel(open ? 'session-tree' : null);
    }
    return {
        diffOpen,
        isChatRoute,
        rightPanel,
        sessionTreeOpen,
        toggleDiff: () => setDiffOpen(!diffOpen),
        closeDiff: () => setDiffOpen(false),
        toggleSessionTree: () => setSessionTreeOpen(!sessionTreeOpen),
        closeSessionTree: () => setSessionTreeOpen(false),
    };
}
