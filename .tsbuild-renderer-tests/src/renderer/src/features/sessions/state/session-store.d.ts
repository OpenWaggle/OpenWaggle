import type { SessionId, SessionNodeId } from '@shared/types/brand';
import type { SessionSummary, SessionTree, SessionWorkspace, SessionWorkspaceSelection } from '@shared/types/session';
export interface DraftBranchState {
    readonly sessionId: SessionId;
    readonly sourceNodeId: SessionNodeId;
}
interface SessionState {
    sessions: readonly SessionSummary[];
    activeSessionTree: SessionTree | null;
    activeWorkspace: SessionWorkspace | null;
    draftBranch: DraftBranchState | null;
    error: string | null;
    loadSessions: () => Promise<void>;
    refreshSessionTree: (sessionId: SessionId | null) => Promise<void>;
    refreshSessionWorkspace: (sessionId: SessionId | null, selection?: SessionWorkspaceSelection) => Promise<void>;
    setActiveSessionTree: (tree: SessionTree | null) => void;
    setActiveWorkspace: (workspace: SessionWorkspace | null) => void;
    setDraftBranch: (draftBranch: DraftBranchState | null) => void;
    clearDraftBranchForSession: (sessionId: SessionId) => void;
    refreshSessionsAndTree: (sessionId: SessionId | null) => Promise<void>;
    refreshSessionsAndWorkspace: (sessionId: SessionId | null, selection?: SessionWorkspaceSelection) => Promise<void>;
    clearError: () => void;
}
export declare const useSessionStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<SessionState>>;
export {};
