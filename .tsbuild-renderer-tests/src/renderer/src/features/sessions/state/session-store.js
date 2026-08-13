import { create } from 'zustand';
import { api } from '@/shared/lib/ipc';
import { createRendererLogger } from '@/shared/lib/logger';
const logger = createRendererLogger('session-store');
let latestTreeRequestId = 0;
let latestWorkspaceRequestId = 0;
function handleStoreError(err, action, setError) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to ${action}`, { message });
    setError(`Failed to ${action}: ${message}`);
}
export const useSessionStore = create((set, get) => ({
    sessions: [],
    activeSessionTree: null,
    activeWorkspace: null,
    draftBranch: null,
    error: null,
    async loadSessions() {
        try {
            const sessions = await api.listSessions();
            set({ sessions, error: null });
        }
        catch (err) {
            handleStoreError(err, 'load sessions', (error) => set({ error }));
        }
    },
    async refreshSessionTree(sessionId) {
        latestTreeRequestId += 1;
        const requestId = latestTreeRequestId;
        if (!sessionId) {
            latestWorkspaceRequestId += 1;
            set({ activeSessionTree: null, activeWorkspace: null });
            return;
        }
        try {
            const activeSessionTree = await api.getSessionTree(sessionId);
            if (requestId !== latestTreeRequestId) {
                return;
            }
            if (activeSessionTree && activeSessionTree.session.id !== sessionId) {
                return;
            }
            set({ activeSessionTree, error: null });
        }
        catch (err) {
            handleStoreError(err, 'refresh session tree', (error) => set({ error }));
        }
    },
    async refreshSessionWorkspace(sessionId, selection) {
        latestWorkspaceRequestId += 1;
        const requestId = latestWorkspaceRequestId;
        if (!sessionId) {
            latestTreeRequestId += 1;
            set({ activeSessionTree: null, activeWorkspace: null });
            return;
        }
        try {
            const activeWorkspace = await api.getSessionWorkspace(sessionId, selection);
            if (requestId !== latestWorkspaceRequestId) {
                return;
            }
            if (activeWorkspace && activeWorkspace.tree.session.id !== sessionId) {
                return;
            }
            set({
                activeWorkspace,
                activeSessionTree: activeWorkspace?.tree ?? null,
                error: null,
            });
        }
        catch (err) {
            handleStoreError(err, 'refresh session workspace', (error) => set({ error }));
        }
    },
    setActiveSessionTree(tree) {
        set({ activeSessionTree: tree });
    },
    setActiveWorkspace(workspace) {
        set({ activeWorkspace: workspace, activeSessionTree: workspace?.tree ?? null });
    },
    setDraftBranch(draftBranch) {
        set({ draftBranch });
    },
    clearDraftBranchForSession(sessionId) {
        set((state) => ({
            draftBranch: state.draftBranch?.sessionId === sessionId ? null : state.draftBranch,
        }));
    },
    async refreshSessionsAndTree(sessionId) {
        await get().loadSessions();
        await get().refreshSessionTree(sessionId);
    },
    async refreshSessionsAndWorkspace(sessionId, selection) {
        await get().loadSessions();
        await get().refreshSessionWorkspace(sessionId, selection);
    },
    clearError() {
        set({ error: null });
    },
}));
