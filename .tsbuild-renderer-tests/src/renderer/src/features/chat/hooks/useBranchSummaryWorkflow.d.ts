import type { SessionBranchId, SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand';
import type { SessionWorkspace } from '@shared/types/session';
import type { useNavigate } from '@tanstack/react-router';
type Navigate = ReturnType<typeof useNavigate>;
interface BranchSummaryWorkflowParams {
    readonly activeSessionId: SessionId | null;
    readonly activeWorkspace: SessionWorkspace | null;
    readonly model: SupportedModelId;
    readonly projectPath: string | null;
    readonly navigate: Navigate;
    readonly loadSessions: () => Promise<void>;
    readonly refreshSession: (sessionId: SessionId) => Promise<void>;
    readonly refreshSessionWorkspace: (sessionId: SessionId, selection?: {
        readonly branchId?: SessionBranchId | null;
        readonly nodeId?: SessionNodeId | null;
    }) => Promise<void>;
    readonly clearDraftBranchForSession: (sessionId: SessionId) => void;
    readonly showToast: (message: string) => void;
}
interface DraftBranchComposerInput {
    readonly sessionId: SessionId;
    readonly sourceNodeId: SessionNodeId;
    readonly fallbackText: string;
}
export declare function useBranchSummaryWorkflow(params: BranchSummaryWorkflowParams): {
    materializeBranchSummary(customInstructions?: string): Promise<void>;
    materializeDraftBranchForSend(draftBranch: {
        readonly sessionId: SessionId;
        readonly sourceNodeId: SessionNodeId;
    } | null): Promise<boolean>;
    cancelBranchSummary(): void;
    skipBranchSummary(): void;
    startCustomBranchSummary(): void;
    switchComposerToDraftBranch(input: DraftBranchComposerInput): string;
};
export {};
