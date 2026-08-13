/**
 * Git state for the active session's Working path.
 *
 * Reads resolve the working tree automatically so callers cannot report on the
 * wrong one. Mutations still take an explicit path, because the caller knows
 * whether it is acting on a working tree or on the repository.
 */
export declare function useGit(): {
    workingPath: string | null;
    repositoryPath: string | null;
    status: import("../../../../../shared/types/git").GitStatusSummary | null;
    isLoading: boolean;
    error: string | null;
    branches: import("../../../../../shared/types/git").GitBranchListResult | null;
    isCommitting: boolean;
    isBranchActionRunning: boolean;
    refreshStatus: (workingPath: string | null) => Promise<void>;
    refreshBranches: (repositoryPath: string | null) => Promise<void>;
    commit: (workingPath: string, payload: import("../../../../../shared/types/git").GitCommitPayload) => Promise<import("../../../../../shared/types/git").GitCommitResult>;
    checkoutBranch: (workingPath: string, payload: import("../../../../../shared/types/git").GitBranchCheckoutPayload) => Promise<import("../../../../../shared/types/git").GitBranchMutationResult>;
    createBranch: (workingPath: string, payload: import("../../../../../shared/types/git").GitBranchCreatePayload) => Promise<import("../../../../../shared/types/git").GitBranchMutationResult>;
};
