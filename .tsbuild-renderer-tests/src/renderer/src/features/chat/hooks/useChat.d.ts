import type { SessionId } from '@shared/types/brand';
import type { SessionDetail, SessionSummary } from '@shared/types/session';
import { type DraftSessionState } from '@/features/chat/state/chat-store';
export interface ChatReturn {
    sessions: SessionSummary[];
    activeSession: SessionDetail | null;
    activeSessionId: SessionId | null;
    draftSession: DraftSessionState | null;
    createSession: (projectPath: string) => Promise<SessionId>;
    startDraftSession: (projectPath?: string | null) => void;
    setActiveSession: (id: SessionId | null) => void;
    refreshSession: (id: SessionId) => Promise<void>;
    deleteSession: (id: SessionId) => Promise<void>;
    updateSessionTitle: (id: SessionId, title: string) => void;
    loadSessions: () => Promise<void>;
}
/**
 * Renderer read model for session navigation.
 *
 * Session switching must be synchronous: the sidebar click only changes the
 * active ID and reads the full session from the local store. Persistence
 * still belongs to main; this store is the renderer-side snapshot/cache.
 */
export declare function useChat(): ChatReturn;
