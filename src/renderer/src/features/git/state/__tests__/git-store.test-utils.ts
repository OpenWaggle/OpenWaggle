export const PROJECT_PATH = '/tmp/repo'

export const GIT_STORE_RESET_STATE = {
  status: null,
  branches: null,
  isLoading: false,
  isCommitting: false,
  isBranchActionRunning: false,
  statusError: null,
  branchesError: null,
}

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
  }
}

export function makeBranchList(overrides = {}) {
  return {
    currentBranch: 'main',
    branches: [],
    ...overrides,
  }
}
