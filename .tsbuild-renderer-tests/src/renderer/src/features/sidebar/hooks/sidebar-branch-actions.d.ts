import type { SupportedModelId } from '@shared/types/brand';
import { SessionId } from '@shared/types/brand';
import type { SessionBranch, SessionSummary, SessionTree, SessionWorkspaceSelection } from '@shared/types/session';
import type { useNavigate } from '@tanstack/react-router';
type Navigate = ReturnType<typeof useNavigate>;
interface SidebarBranchActionDeps {
    readonly activeBranchId: SessionTree['session']['lastActiveBranchId'];
    readonly activeSessionId: SessionId | null;
    readonly archiveSession: (sessionId: SessionId) => void;
    readonly clearDraftBranchForSession: (sessionId: SessionId) => void;
    readonly navigate: Navigate;
    readonly refreshAfterSessionMutation: (sessionId: SessionId) => Promise<void>;
    readonly refreshSessionWorkspace: (sessionId: SessionId | null, selection?: SessionWorkspaceSelection) => Promise<void>;
    readonly selectedModel: SupportedModelId;
    readonly sessions: readonly SessionSummary[];
    readonly showToast: (message: string) => void;
}
export declare function createSidebarBranchActions(deps: SidebarBranchActionDeps): {
    archive(sessionId: string, branch: SessionBranch): void;
    rename(sessionId: string, branch: SessionBranch, name: string): void;
    select(sessionId: string, branch: SessionBranch): void;
    toggle(sessionId: SessionId, collapsed: boolean): void;
};
export {};
