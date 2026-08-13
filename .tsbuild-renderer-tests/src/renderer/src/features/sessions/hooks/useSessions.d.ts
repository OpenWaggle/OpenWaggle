import type { SessionId } from '@shared/types/brand';
import type { SessionWorkspaceSelection } from '@shared/types/session';
import { useSessionStore } from '@/features/sessions/state/session-store';
export interface SessionsReturn {
    sessions: ReturnType<typeof useSessionStore.getState>['sessions'];
    activeSessionTree: ReturnType<typeof useSessionStore.getState>['activeSessionTree'];
    activeWorkspace: ReturnType<typeof useSessionStore.getState>['activeWorkspace'];
    draftBranch: ReturnType<typeof useSessionStore.getState>['draftBranch'];
    loadSessions: () => Promise<void>;
    refreshSessionTree: (sessionId: SessionId | null) => Promise<void>;
    refreshSessionWorkspace: (sessionId: SessionId | null, selection?: SessionWorkspaceSelection) => Promise<void>;
    refreshSessionsAndTree: (sessionId: SessionId | null) => Promise<void>;
    refreshSessionsAndWorkspace: (sessionId: SessionId | null, selection?: SessionWorkspaceSelection) => Promise<void>;
    clearDraftBranchForSession: (sessionId: SessionId) => void;
}
export declare function useSessions(): SessionsReturn;
