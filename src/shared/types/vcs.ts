// VCS status, source control, and stacked git action types (WS2-WS4, ADR 0012).
// Split out of git.ts to keep each module focused.

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
  readonly changeRequest: VcsChangeRequest | null
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

// --- Source control provider (WS3, ADR 0012) ---

export interface SourceControlAuthStatus {
  readonly authenticated: boolean
  readonly account: string | null
  readonly host: string | null
}

export const SOURCE_CONTROL_ERROR_CODES = [
  'cli-missing',
  'not-authenticated',
  'no-change-request',
  'unknown',
] as const

export type SourceControlErrorCode = (typeof SOURCE_CONTROL_ERROR_CODES)[number]

export interface SourceControlFailure {
  readonly ok: false
  readonly code: SourceControlErrorCode
  readonly message: string
}

export interface SourceControlAuthSuccess {
  readonly ok: true
  readonly status: SourceControlAuthStatus
}

export type SourceControlAuthResult = SourceControlAuthSuccess | SourceControlFailure

export interface OpenChangeRequestPayload {
  readonly headRef: string
  readonly baseRef: string
  readonly title: string
  readonly body?: string
  readonly draft?: boolean
}

export interface ChangeRequestSuccess {
  readonly ok: true
  readonly changeRequest: VcsChangeRequest
}

export type ChangeRequestResult = ChangeRequestSuccess | SourceControlFailure

export interface ChangeRequestListSuccess {
  readonly ok: true
  readonly changeRequests: readonly VcsChangeRequest[]
}

export type ChangeRequestListResult = ChangeRequestListSuccess | SourceControlFailure

export interface ChangeRequestCheckoutSuccess {
  readonly ok: true
  readonly reference: string
}

/** Result of checking a change request out into a working tree / Session worktree. */
export type ChangeRequestCheckoutResult = ChangeRequestCheckoutSuccess | SourceControlFailure

// --- Stacked git actions (WS4, ADR 0012) ---

export const GIT_STACKED_ACTIONS = [
  'commit',
  'push',
  'create_pr',
  'commit_push',
  'commit_push_pr',
  'pull',
] as const
export type GitStackedAction = (typeof GIT_STACKED_ACTIONS)[number]

export type GitActionPhase = 'branch' | 'commit' | 'push' | 'pr'

export interface GitActionProgressEvent {
  readonly phase: GitActionPhase
  readonly label: string
  readonly index: number
  readonly total: number
}

export interface GitRunStackedActionOptions {
  readonly action: GitStackedAction
  readonly commitMessage?: string
  readonly createFeatureBranch?: boolean
  readonly featureBranchName?: string
  readonly baseRef?: string
  readonly changeRequestTitle?: string
  readonly changeRequestBody?: string
  readonly draft?: boolean
  /**
   * Repo-relative paths to stage for the commit phase.
   *
   * Required in practice: an empty or omitted selection reports `nothing-to-commit` rather than
   * staging the whole repository. `git add --all` has no pathspec, so the old fallback reached
   * past the opened directory and swept the user's unrelated in-flight work into the commit.
   */
  readonly paths?: readonly string[]
}

export const GIT_STACKED_ACTION_ERROR_CODES = [
  'not-git-repo',
  'nothing-to-commit',
  'no-upstream',
  'push-failed',
  'pull-failed',
  'branch-failed',
  'change-request-failed',
  'commit-message-required',
  'cancelled',
  'unknown',
] as const
export type GitStackedActionErrorCode = (typeof GIT_STACKED_ACTION_ERROR_CODES)[number]

/** A stacked-action precondition probe that could not answer. */
export interface GitStackedActionProbeFailure {
  readonly ok: false
  readonly message: string
}

export interface GitStackedActionBranchOutcome {
  readonly status: 'created' | 'unchanged'
  readonly name: string | null
}

export interface GitRunStackedActionSuccess {
  readonly ok: true
  readonly action: GitStackedAction
  readonly branch: GitStackedActionBranchOutcome
  readonly changeRequest: VcsChangeRequest | null
}

export interface GitRunStackedActionFailure {
  readonly ok: false
  readonly phase: GitActionPhase
  readonly code: GitStackedActionErrorCode
  readonly message: string
}

export type GitRunStackedActionResult = GitRunStackedActionSuccess | GitRunStackedActionFailure
