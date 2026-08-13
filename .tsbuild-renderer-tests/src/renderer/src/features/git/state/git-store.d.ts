import type { GitBranchCheckoutPayload, GitBranchCreatePayload, GitBranchListResult, GitBranchMutationResult, GitCommitPayload, GitCommitResult, GitStatusSummary } from '@shared/types/git';
/** Status for one working tree. Keyed by Working path so sessions do not overwrite each other. */
export interface GitWorkingTreeStatus {
    readonly status: GitStatusSummary | null;
    readonly isLoading: boolean;
    readonly error: string | null;
}
interface GitState {
    /**
     * Status per Working path (ADR 0016). A single slot could not represent two
     * sessions running in two worktrees, which is exactly the case this fixes.
     */
    statusByWorkingPath: Readonly<Record<string, GitWorkingTreeStatus>>;
    /**
     * Branch list is repository-level, not per session: a linked worktree shares
     * `refs/` with the primary checkout, so one slot is correct and a map would
     * duplicate identical data per session.
     */
    branches: GitBranchListResult | null;
    branchesError: string | null;
    isCommitting: boolean;
    isBranchActionRunning: boolean;
    refreshStatus: (workingPath: string | null) => Promise<void>;
    refreshBranches: (repositoryPath: string | null) => Promise<void>;
    commit: (workingPath: string, payload: GitCommitPayload) => Promise<GitCommitResult>;
    checkoutBranch: (workingPath: string, payload: GitBranchCheckoutPayload) => Promise<GitBranchMutationResult>;
    createBranch: (workingPath: string, payload: GitBranchCreatePayload) => Promise<GitBranchMutationResult>;
}
/** Read one working tree's status slice, defaulting to empty rather than undefined. */
export declare function selectWorkingTreeStatus(state: Pick<GitState, 'statusByWorkingPath'>, workingPath: string | null): GitWorkingTreeStatus;
export declare const useGitStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<GitState>>;
export {};
