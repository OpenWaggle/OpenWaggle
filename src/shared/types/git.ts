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
  readonly unstaged: boolean
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

export const GIT_WORKING_TREE_ERROR_CODES = [
  'cancelled',
  'not-git-repo',
  'no-head',
  'partial-revert',
  'unsafe-revert',
  'unknown',
] as const

export type GitWorkingTreeErrorCode = (typeof GIT_WORKING_TREE_ERROR_CODES)[number]

export interface GitWorkingTreeMutationSuccess {
  readonly ok: true
  readonly message: string
}

export interface GitWorkingTreeMutationFailure {
  readonly ok: false
  readonly code: GitWorkingTreeErrorCode
  readonly message: string
}

export type GitWorkingTreeMutationResult =
  | GitWorkingTreeMutationSuccess
  | GitWorkingTreeMutationFailure

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

export const GIT_DIFF_ERROR_CODES = ['not-git-repo', 'bad-revision', 'unknown'] as const

export type GitDiffErrorCode = (typeof GIT_DIFF_ERROR_CODES)[number]

export interface GitDiffSuccess {
  readonly ok: true
  readonly files: readonly GitFileDiff[]
}

export interface GitDiffFailure {
  readonly ok: false
  readonly code: GitDiffErrorCode
  readonly message: string
}

/**
 * Loading a diff fails for ordinary, expected reasons -- a folder that is not a
 * repository, a base ref the user typed that no longer resolves. Those are results,
 * not exceptions, so callers branch on `ok` instead of wrapping every call in
 * try/catch (see ADR-less standard in .agents/standards.md).
 */
export type GitDiffResult = GitDiffSuccess | GitDiffFailure

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

// --- Session worktrees (ADR 0010) ---

/**
 * How a session's git work is isolated.
 * `local` edits the opened checkout; `worktree` uses a dedicated Session worktree.
 */
export type SessionEnvironmentMode = 'local' | 'worktree'

export const SESSION_ENVIRONMENT_MODES = ['local', 'worktree'] as const

export interface GitWorktreeInfo {
  /** Absolute path of the worktree checkout. */
  readonly path: string
  /** Branch checked out in the worktree, or null when detached. */
  readonly branch: string | null
  /** Commit the worktree points at. */
  readonly head: string
  /** True for the repository's primary (main) worktree. */
  readonly isMain: boolean
}

export interface GitWorktreeListResult {
  readonly worktrees: readonly GitWorktreeInfo[]
}

export interface GitWorktreeCreatePayload {
  /** Absolute path where the worktree checkout is created. */
  readonly path: string
  /** Temporary branch created for the worktree (git worktree add -b). */
  readonly branch: string
  /** Base ref the worktree branch starts from. */
  readonly baseRef: string
}

export interface GitWorktreeRemovePayload {
  readonly path: string
  /** Only pass true on explicit user request; otherwise git refuses dirty removals. */
  readonly force?: boolean
}

export const GIT_WORKTREE_ERROR_CODES = [
  'not-git-repo',
  'base-ref-not-found',
  'worktree-exists',
  'branch-exists',
  'dirty-worktree',
  'not-found',
  'unknown',
] as const

export type GitWorktreeErrorCode = (typeof GIT_WORKTREE_ERROR_CODES)[number]

export interface GitWorktreeMutationSuccess {
  readonly ok: true
  readonly message: string
  readonly path: string
}

export interface GitWorktreeMutationFailure {
  readonly ok: false
  readonly code: GitWorktreeErrorCode
  readonly message: string
}

export type GitWorktreeMutationResult = GitWorktreeMutationSuccess | GitWorktreeMutationFailure

// VCS status / source control / stacked action types live in ./vcs (kept separate for module size).
export * from './vcs'
