import type { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand';
import type { SessionBranch, SessionSummary, SessionTree } from '@shared/types/session';
interface SidebarDraftBranchInput {
    readonly sessionId: SessionId;
    readonly sourceNodeId: SessionNodeId;
}
export type SidebarBranchRow = {
    readonly type: 'draft';
    readonly sourceNodeId: SessionNodeId;
} | {
    readonly type: 'branch';
    readonly branch: SessionBranch;
    readonly isActive: boolean;
};
interface BuildSidebarBranchRowsInput {
    readonly session: SessionSummary;
    readonly activeSessionTree?: SessionTree | null;
    readonly activeBranchId?: SessionBranchId | null | undefined;
    readonly branchesCollapsed?: boolean;
    readonly draftBranch: SidebarDraftBranchInput | null;
}
export declare function buildSidebarBranchRows(input: BuildSidebarBranchRowsInput): readonly SidebarBranchRow[];
export {};
