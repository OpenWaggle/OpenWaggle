import type { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand';
export interface ComposerDraftContextInput {
    readonly projectPath: string | null;
    readonly sessionId: SessionId | null;
    readonly activeBranchId?: SessionBranchId | null;
    readonly activeNodeId?: SessionNodeId | null;
    readonly draftSourceNodeId?: SessionNodeId | null;
}
export declare function buildComposerDraftContextKey(input: ComposerDraftContextInput): string;
