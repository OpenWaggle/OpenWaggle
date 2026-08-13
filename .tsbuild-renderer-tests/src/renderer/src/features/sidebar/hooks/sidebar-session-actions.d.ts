import type { SupportedModelId } from '@shared/types/brand';
import { type SessionId } from '@shared/types/brand';
import type { SessionTree, SessionWorkspace } from '@shared/types/session';
import type { useNavigate } from '@tanstack/react-router';
type Navigate = ReturnType<typeof useNavigate>;
interface SidebarSessionActionDeps {
    readonly activeSessionId: SessionId | null;
    readonly matchingActiveSessionTree: SessionTree | null;
    readonly matchingActiveWorkspace: SessionWorkspace | null;
    readonly navigate: Navigate;
    readonly projectPath: string | null;
    readonly selectedModel: SupportedModelId;
    readonly showToast: (message: string) => void;
    readonly startDraftSession: (projectPath: string | null) => void;
    readonly clearTransientDraftContext: () => void;
    readonly deleteSession: (sessionId: SessionId) => Promise<void>;
    readonly loadChatSessions: () => Promise<void>;
    readonly loadSessionTrees: () => Promise<void>;
    readonly refreshSessionWorkspace: (sessionId: SessionId | null) => Promise<void>;
}
export declare function createSidebarSessionActions(deps: SidebarSessionActionDeps): {
    archive(sessionId: SessionId): void;
    clone(sessionId: SessionId): void;
    delete(sessionId: SessionId): void;
    select(id: SessionId): void;
};
export {};
