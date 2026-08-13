import { useChatStore } from '@/features/chat/state/chat-store';
/**
 * Renderer read model for session navigation.
 *
 * Session switching must be synchronous: the sidebar click only changes the
 * active ID and reads the full session from the local store. Persistence
 * still belongs to main; this store is the renderer-side snapshot/cache.
 */
export function useChat() {
    const sessions = useChatStore((s) => s.sessions);
    const activeSession = useChatStore((s) => s.activeSession);
    const activeSessionId = useChatStore((s) => s.activeSessionId);
    const draftSession = useChatStore((s) => s.draftSession);
    const createSession = useChatStore((s) => s.createSession);
    const startDraftSession = useChatStore((s) => s.startDraftSession);
    const setActiveSession = useChatStore((s) => s.setActiveSession);
    const refreshSession = useChatStore((s) => s.refreshSession);
    const deleteSession = useChatStore((s) => s.deleteSession);
    const updateSessionTitle = useChatStore((s) => s.updateSessionTitle);
    const loadSessions = useChatStore((s) => s.loadSessions);
    return {
        sessions,
        activeSession,
        activeSessionId,
        draftSession,
        createSession,
        startDraftSession,
        setActiveSession,
        refreshSession,
        deleteSession,
        updateSessionTitle,
        loadSessions,
    };
}
