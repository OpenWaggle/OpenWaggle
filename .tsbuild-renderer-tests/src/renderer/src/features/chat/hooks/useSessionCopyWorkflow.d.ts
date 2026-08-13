import { type SessionId, SessionNodeId, type SupportedModelId } from '@shared/types/brand';
import type { SessionWorkspace } from '@shared/types/session';
import type { useNavigate } from '@tanstack/react-router';
import { type SessionForkTarget } from '../lib/session-fork-targets';
type Navigate = ReturnType<typeof useNavigate>;
interface SessionCopyWorkflowParams {
    readonly activeSessionId: SessionId | null;
    readonly activeWorkspace: SessionWorkspace | null;
    readonly draftBranchSourceNodeId: SessionNodeId | null;
    readonly model: SupportedModelId;
    readonly projectPath: string | null;
    readonly navigate: Navigate;
    readonly setActiveSession: (sessionId: SessionId | null) => void;
    readonly loadSessions: () => Promise<void>;
    readonly refreshSession: (sessionId: SessionId) => Promise<void>;
    readonly refreshSessionWorkspace: (sessionId: SessionId | null) => Promise<void>;
    readonly showToast: (message: string) => void;
}
export declare function useSessionCopyWorkflow(params: SessionCopyWorkflowParams): {
    forkSelectorOpen: boolean;
    forkTargets: readonly SessionForkTarget[];
    closeForkSelector(): void;
    cloneCurrentSessionToNewSession(): Promise<void>;
    forkMessageToNewSession(messageId: string): Promise<void>;
    openForkSelector(): void;
    selectForkTarget(target: SessionForkTarget): void;
};
export {};
