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

// --- VCS status: Local/Remote split (WS2, ADR 0012) ---

export type SourceControlProviderId = 'github' | 'gitlab'

export interface SourceControlProviderInfo {
  readonly id: SourceControlProviderId
  readonly host: string
}

export type ChangeRequestState = 'open' | 'merged' | 'closed' | 'draft'

/** Provider-neutral change request (GitHub PR / GitLab MR). */
export interface VcsChangeRequest {
  readonly title: string
  readonly url: string
  readonly baseRef: string
  readonly headRef: string
  readonly state: ChangeRequestState
}

export interface VcsWorkingTreeFile {
  readonly path: string
  readonly insertions: number
  readonly deletions: number
}

export interface VcsWorkingTree {
  readonly files: readonly VcsWorkingTreeFile[]
  readonly insertions: number
  readonly deletions: number
}

/** Network-free status the diff panel can read instantly. */
export interface LocalVcsStatus {
  readonly isRepo: boolean
  readonly sourceControlProvider: SourceControlProviderInfo | null
  readonly hasPrimaryRemote: boolean
  readonly isDefaultRef: boolean
  readonly refName: string | null
  readonly hasWorkingTreeChanges: boolean
  readonly workingTree: VcsWorkingTree
}

/** Network-derived status loaded asynchronously. */
export interface RemoteVcsStatus {
  readonly hasUpstream: boolean
  readonly aheadCount: number
  readonly behindCount: number
  readonly aheadOfDefaultCount: number | null
  readonly pr: VcsChangeRequest | null
}

/** Combined view for the git-actions control (Local + Remote). */
export type VcsStatus = LocalVcsStatus & RemoteVcsStatus

export const VCS_STATUS_ERROR_CODES = ['not-a-repo', 'remote-unreachable', 'unknown'] as const
export type VcsStatusErrorCode = (typeof VCS_STATUS_ERROR_CODES)[number]

export interface LocalVcsStatusSuccess {
  readonly ok: true
  readonly status: LocalVcsStatus
}

export interface RemoteVcsStatusSuccess {
  readonly ok: true
  readonly status: RemoteVcsStatus
}

export interface VcsStatusFailure {
  readonly ok: false
  readonly code: VcsStatusErrorCode
  readonly message: string
}

export type LocalVcsStatusResult = LocalVcsStatusSuccess | VcsStatusFailure
export type RemoteVcsStatusResult = RemoteVcsStatusSuccess | VcsStatusFailure
