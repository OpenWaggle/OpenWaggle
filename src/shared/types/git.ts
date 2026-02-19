export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'unknown'

export interface GitChangedFile {
  readonly path: string
  readonly status: GitFileStatus
  readonly staged: boolean
  readonly additions: number
  readonly deletions: number
}

export interface GitStatusSummary {
  readonly branch: string
  readonly additions: number
  readonly deletions: number
  readonly filesChanged: number
  readonly changedFiles: readonly GitChangedFile[]
  readonly clean: boolean
  readonly ahead: number
  readonly behind: number
}

export interface GitCommitPayload {
  readonly message: string
  readonly amend: boolean
  readonly paths: readonly string[]
}

export const GIT_COMMIT_ERROR_CODES = [
  'not-git-repo',
  'nothing-to-commit',
  'merge-in-progress',
  'empty-message',
  'unknown',
] as const

export type GitCommitErrorCode = (typeof GIT_COMMIT_ERROR_CODES)[number]

export interface GitCommitSuccess {
  readonly ok: true
  readonly commitHash: string
  readonly summary: string
}

export interface GitCommitFailure {
  readonly ok: false
  readonly code: GitCommitErrorCode
  readonly message: string
}

export type GitCommitResult = GitCommitSuccess | GitCommitFailure

export interface GitFileDiff {
  readonly path: string
  readonly diff: string
  readonly additions: number
  readonly deletions: number
}

export interface GitBranchInfo {
  readonly name: string
  readonly fullName: string
  readonly isCurrent: boolean
  readonly isRemote: boolean
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
}

export interface GitBranchListResult {
  readonly currentBranch: string | null
  readonly branches: readonly GitBranchInfo[]
}

export interface GitBranchCheckoutPayload {
  readonly name: string
}

export interface GitBranchCreatePayload {
  readonly name: string
  readonly startPoint?: string
  readonly checkout?: boolean
}

export interface GitBranchRenamePayload {
  readonly from: string
  readonly to: string
}

export interface GitBranchDeletePayload {
  readonly name: string
  readonly force?: boolean
}

export interface GitBranchSetUpstreamPayload {
  readonly name: string
  readonly upstream: string
}

export const GIT_BRANCH_ERROR_CODES = [
  'not-git-repo',
  'branch-not-found',
  'branch-exists',
  'dirty-worktree',
  'invalid-name',
  'upstream-not-found',
  'unknown',
] as const

export type GitBranchErrorCode = (typeof GIT_BRANCH_ERROR_CODES)[number]

export interface GitBranchMutationSuccess {
  readonly ok: true
  readonly message: string
}

export interface GitBranchMutationFailure {
  readonly ok: false
  readonly code: GitBranchErrorCode
  readonly message: string
}

export type GitBranchMutationResult = GitBranchMutationSuccess | GitBranchMutationFailure
