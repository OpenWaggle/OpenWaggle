// VCS status, source control, and stacked git action types (WS2-WS4, ADR 0012).
// Split out of git.ts to keep each module focused.

import type { SessionId } from './brand'

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
  /** Locally resolved default branch name, when the primary remote's HEAD provides one. */
  readonly defaultRef?: string | null
  readonly isDefaultRef: boolean
  readonly refName: string | null
  /**
   * The branch a push from here would update, which is not always the branch you are on.
   *
   * A push follows the upstream mapping, so standing on `feature` with an upstream of `origin/main` writes
   * `main`. Verified against real git: a bare `git push` in that state reported `feature -> main`. The
   * default-branch confirmation has to judge the destination, not the source, or it waves through exactly the
   * push it exists to catch.
   */
  readonly pushTargetRef: string | null
  /** Whether {@link pushTargetRef} is the default branch. Unknown counts as yes, as with `isDefaultRef`. */
  readonly pushTargetIsDefaultRef: boolean
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
  /**
   * Repository owner/namespace that received the pushed head. GitHub requires
   * `owner:branch` when the head lives in a fork; a bare branch can otherwise
   * resolve to an unrelated same-named ref in the base repository.
   */
  readonly headOwner?: string
  /**
   * Full source repository path when the pushed head lives in a fork. GitLab
   * uses it for `--head`; GitHub needs it for the REST fallback that supports
   * organization-owned and renamed forks.
   */
  readonly headRepository?: string
  /** Omitted when the provider should use the repository's configured default branch. */
  readonly baseRef?: string
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
  /** Session that initiated the action, used only to project created outputs. */
  readonly sessionId?: SessionId
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
  readonly commit: {
    readonly commitHash: string
    readonly summary: string
  } | null
  /** Output projection outcome; failed projections say whether durable retry was authorized. */
  readonly commitOutput?:
    | { readonly ok: true }
    | { readonly ok: false; readonly message: string; readonly retryPersisted: boolean }
  readonly changeRequest: VcsChangeRequest | null
  /** Main-process projection outcome for the created request, when a Session initiated it. */
  readonly changeRequestOutput?:
    | { readonly ok: true }
    | { readonly ok: false; readonly message: string; readonly retryPersisted: boolean }
}

export interface GitRunStackedActionFailure {
  readonly ok: false
  readonly phase: GitActionPhase
  readonly code: GitStackedActionErrorCode
  readonly message: string
  /** Prepared branch retained after a later phase failed, so retry can resume it safely. */
  readonly branch?: GitStackedActionBranchOutcome
  /** Commit retained when a later push or change-request phase failed. */
  readonly commit?: GitRunStackedActionSuccess['commit']
  /** Output projection outcome when the commit succeeded before a later phase failed. */
  readonly commitOutput?: GitRunStackedActionSuccess['commitOutput']
  /** Provider web composer used when the native CLI is unavailable or unauthenticated. */
  readonly fallbackUrl?: string
}

export type GitRunStackedActionResult = GitRunStackedActionSuccess | GitRunStackedActionFailure
