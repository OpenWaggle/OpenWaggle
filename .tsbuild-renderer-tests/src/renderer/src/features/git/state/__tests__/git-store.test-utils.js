export const PROJECT_PATH = '/tmp/repo';
export const GIT_STORE_RESET_STATE = {
    statusByWorkingPath: {},
    branches: null,
    branchesError: null,
    isCommitting: false,
    isBranchActionRunning: false,
};
export function makeGitStatus(overrides = {}) {
    return {
        branch: 'main',
        additions: 0,
        deletions: 0,
        filesChanged: 0,
        changedFiles: [],
        clean: true,
        ahead: 0,
        behind: 0,
        ...overrides,
    };
}
export function makeBranchList(overrides = {}) {
    return {
        currentBranch: 'main',
        branches: [],
        ...overrides,
    };
}
/**
 * Seed one working tree's status. Status is keyed by Working path (ADR 0016), so a
 * test must say which tree it is describing rather than setting a global slot.
 */
export function statusFor(workingPath, status = makeGitStatus()) {
    return { [workingPath]: { status, isLoading: false, error: null } };
}
