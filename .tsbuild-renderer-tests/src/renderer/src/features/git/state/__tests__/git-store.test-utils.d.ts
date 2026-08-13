import type { GitStatusSummary } from '@shared/types/git';
export declare const PROJECT_PATH = "/tmp/repo";
export declare const GIT_STORE_RESET_STATE: {
    statusByWorkingPath: {};
    branches: null;
    branchesError: null;
    isCommitting: boolean;
    isBranchActionRunning: boolean;
};
export declare function makeGitStatus(overrides?: Partial<GitStatusSummary>): GitStatusSummary;
export declare function makeBranchList(overrides?: {}): {
    currentBranch: string;
    branches: never[];
};
/**
 * Seed one working tree's status. Status is keyed by Working path (ADR 0016), so a
 * test must say which tree it is describing rather than setting a global slot.
 */
export declare function statusFor(workingPath: string, status?: GitStatusSummary | null): {
    [workingPath]: {
        status: GitStatusSummary | null;
        isLoading: boolean;
        error: null;
    };
};
