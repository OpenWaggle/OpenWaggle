import { RepositoryPath, WorkingPath } from '@shared/types/brand'
import type { GitStatusSummary } from '@shared/types/git'

export const PROJECT_PATH = '/tmp/repo'
/** The same path in its two roles, branded so store actions accept them (ADR 0018). */
export const WORKING_PATH = WorkingPath(PROJECT_PATH)
export const REPOSITORY_PATH = RepositoryPath(PROJECT_PATH)

export const GIT_STORE_RESET_STATE = {
  statusByWorkingPath: {},
  branches: null,
  branchesError: null,
  isCommitting: false,
  isBranchActionRunning: false,
}

export function makeGitStatus(overrides: Partial<GitStatusSummary> = {}): GitStatusSummary {
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

/**
 * Seed one working tree's status. Status is keyed by Working path (ADR 0018), so a
 * test must say which tree it is describing rather than setting a global slot.
 */
export function statusFor(workingPath: string, status: GitStatusSummary | null = makeGitStatus()) {
  return { [workingPath]: { status, isLoading: false, error: null } }
}
