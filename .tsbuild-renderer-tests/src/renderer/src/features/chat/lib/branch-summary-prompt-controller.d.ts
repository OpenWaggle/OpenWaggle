import type { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand';
import type { SessionWorkspace } from '@shared/types/session';
interface BranchSummaryPromptSelection {
    readonly branchId: SessionBranchId | null;
    readonly nodeId: SessionNodeId | null;
}
export interface BranchSummaryPromptOpenRequest {
    readonly sessionId: SessionId;
    readonly sourceNodeId: SessionNodeId;
    readonly restoreSelection: BranchSummaryPromptSelection;
    readonly previousComposerText: string;
    readonly draftComposerText: string;
    readonly activeWorkspace: SessionWorkspace | null;
    readonly projectPath: string | null;
}
export declare function maybeOpenBranchSummaryPrompt(input: BranchSummaryPromptOpenRequest): void;
export {};
