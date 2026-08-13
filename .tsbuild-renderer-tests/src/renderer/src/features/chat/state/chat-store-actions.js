import { useComposerStore } from '@/features/composer/state';
import { useDiffScopeStore } from '@/features/diff-panel';
import { useSessionStore } from '@/features/sessions/state';
import { api } from '@/shared/lib/ipc';
import { handleStoreError, isSameSessionId, mergeSummary, optionalSessionId, refreshSessionStoreForSession, removeSummary, toSessionId, toSummary, } from './chat-store-helpers';
function setError(set) {
    return (error) => set({ error });
}
async function loadSessions(set, get) {
    try {
        const all = await api.listSessionDetails();
        const sessionById = new Map();
        const sessions = [];
        for (const session of all) {
            sessionById.set(session.id, session);
            const summary = toSummary(session);
            if (summary.title !== 'New session' || (summary.messageCount ?? 0) > 0) {
                sessions.push(summary);
            }
        }
        const activeSessionId = get().activeSessionId;
        const activeSession = activeSessionId ? (sessionById.get(activeSessionId) ?? null) : null;
        const missingSessionIds = new Set(get().missingSessionIds);
        for (const session of all) {
            missingSessionIds.delete(session.id);
        }
        if (activeSessionId && !activeSession) {
            missingSessionIds.add(activeSessionId);
        }
        set({
            sessions,
            sessionById,
            missingSessionIds,
            draftSession: activeSession ? null : get().draftSession,
            activeSessionId: activeSession ? activeSessionId : null,
            activeSession,
            error: null,
        });
        void useSessionStore.getState().loadSessions();
    }
    catch (err) {
        handleStoreError(err, 'load sessions', setError(set));
    }
}
async function createSession(projectPath, set, get) {
    try {
        const session = await api.createSession(projectPath);
        get().upsertSession(session);
        set({
            activeSessionId: session.id,
            activeSession: session,
            draftSession: null,
            missingSessionIds: new Set([...get().missingSessionIds].filter((missingId) => missingId !== session.id)),
            error: null,
        });
        void useSessionStore.getState().refreshSessionsAndTree(toSessionId(session.id));
        return session.id;
    }
    catch (err) {
        handleStoreError(err, 'create session', setError(set));
        throw err;
    }
}
function setActiveSession(id, set, get) {
    if (!id || get().missingSessionIds.has(id)) {
        set({ activeSessionId: null, activeSession: null, draftSession: null });
        return;
    }
    const cached = get().sessionById.get(id) ?? null;
    set({ activeSessionId: id, activeSession: cached, draftSession: null });
    if (!cached) {
        void get().refreshSession(id);
    }
}
async function refreshSession(id, set, get) {
    try {
        const session = await api.getSessionDetail(id);
        const wasActiveSession = isSameSessionId(get().activeSessionId, id);
        if (!session) {
            removeMissingSession(id, set);
            refreshMissingSessionTree(wasActiveSession);
            return;
        }
        get().upsertSession(session);
        refreshSessionStoreForSession(id, get().activeSessionId);
    }
    catch (err) {
        handleStoreError(err, 'refresh session', setError(set));
    }
}
function removeMissingSession(id, set) {
    set((state) => {
        const sessionById = new Map(state.sessionById);
        const missingSessionIds = new Set(state.missingSessionIds);
        sessionById.delete(id);
        missingSessionIds.add(id);
        return {
            sessionById,
            missingSessionIds,
            sessions: removeSummary(state.sessions, id),
            ...(state.activeSessionId === id
                ? { activeSessionId: null, activeSession: null, draftSession: null }
                : {}),
        };
    });
}
function refreshMissingSessionTree(wasActiveSession) {
    if (wasActiveSession) {
        void useSessionStore.getState().refreshSessionTree(null);
        return;
    }
    void useSessionStore.getState().loadSessions();
}
function upsertSession(session, set) {
    set((state) => {
        const sessionById = new Map(state.sessionById);
        const missingSessionIds = new Set(state.missingSessionIds);
        sessionById.set(session.id, session);
        missingSessionIds.delete(session.id);
        return {
            sessionById,
            missingSessionIds,
            sessions: mergeSummary(state.sessions, toSummary(session)),
            draftSession: state.activeSessionId === session.id ? null : state.draftSession,
            activeSession: state.activeSessionId === session.id ? session : state.activeSession,
            error: null,
        };
    });
}
async function deleteSession(id, set, get) {
    const previous = get();
    removeMissingSession(id, set);
    try {
        await api.deleteSession(id);
        useComposerStore.getState().clearScopedDraftsForSession(String(id));
        useDiffScopeStore.getState().removeThread(String(id));
        void useSessionStore.getState().refreshSessionsAndTree(optionalSessionId(get().activeSessionId));
    }
    catch (err) {
        set({
            sessions: previous.sessions,
            sessionById: previous.sessionById,
            missingSessionIds: previous.missingSessionIds,
            draftSession: previous.draftSession,
            activeSessionId: previous.activeSessionId,
            activeSession: previous.activeSession,
        });
        handleStoreError(err, 'delete session', setError(set));
        throw err;
    }
}
function updateSessionTitle(id, title, set, get) {
    set((state) => {
        const existing = state.sessionById.get(id);
        if (!existing) {
            const now = Date.now();
            return {
                sessions: mergeSummary(state.sessions, {
                    id,
                    title,
                    projectPath: null,
                    messageCount: 1,
                    createdAt: now,
                    updatedAt: now,
                }),
            };
        }
        const session = { ...existing, title };
        const sessionById = new Map(state.sessionById);
        sessionById.set(id, session);
        return {
            sessionById,
            sessions: mergeSummary(state.sessions, toSummary(session)),
            activeSession: state.activeSessionId === id ? session : state.activeSession,
        };
    });
    refreshSessionStoreForSession(id, get().activeSessionId);
}
export function createChatActions(set, get) {
    return {
        loadSessions: () => loadSessions(set, get),
        createSession: (projectPath) => createSession(projectPath, set, get),
        startDraftSession: (projectPath = null) => set({ activeSessionId: null, activeSession: null, draftSession: { projectPath } }),
        setActiveSessionId: (id) => get().setActiveSession(id),
        setActiveSession: (id) => setActiveSession(id, set, get),
        refreshSession: (id) => refreshSession(id, set, get),
        upsertSession: (session) => upsertSession(session, set),
        deleteSession: (id) => deleteSession(id, set, get),
        updateSessionTitle: (id, title) => updateSessionTitle(id, title, set, get),
        clearError: () => set({ error: null }),
    };
}
