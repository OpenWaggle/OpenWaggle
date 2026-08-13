import { useSessionStore } from '@/features/sessions/state/session-store';
export function useSessions() {
    const sessions = useSessionStore((s) => s.sessions);
    const activeSessionTree = useSessionStore((s) => s.activeSessionTree);
    const activeWorkspace = useSessionStore((s) => s.activeWorkspace);
    const draftBranch = useSessionStore((s) => s.draftBranch);
    const loadSessions = useSessionStore((s) => s.loadSessions);
    const refreshSessionTree = useSessionStore((s) => s.refreshSessionTree);
    const refreshSessionWorkspace = useSessionStore((s) => s.refreshSessionWorkspace);
    const refreshSessionsAndTree = useSessionStore((s) => s.refreshSessionsAndTree);
    const refreshSessionsAndWorkspace = useSessionStore((s) => s.refreshSessionsAndWorkspace);
    const clearDraftBranchForSession = useSessionStore((s) => s.clearDraftBranchForSession);
    return {
        sessions,
        activeSessionTree,
        activeWorkspace,
        draftBranch,
        loadSessions,
        refreshSessionTree,
        refreshSessionWorkspace,
        refreshSessionsAndTree,
        refreshSessionsAndWorkspace,
        clearDraftBranchForSession,
    };
}
