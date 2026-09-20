export type SourceControlProviderId = 'github' | 'gitlab'

export interface SourceControlProviderInfo {
  readonly id: SourceControlProviderId
  readonly host: string
}

/**
 * Repository identity resolved from the Git remote topology before invoking a provider CLI.
 *
 * Provider adapters bind every repository-scoped command to this exact host and path. Keeping
 * the identity explicit prevents ambient gh/glab defaults from silently selecting another repo.
 */
export interface SourceControlRepositoryIdentity {
  readonly provider: SourceControlProviderId
  /** Web/API authority, including a non-default HTTPS port when the remote provides one. */
  readonly host: string
  /** GitHub owner or full GitLab namespace (including nested groups). */
  readonly owner: string
  readonly repository: string
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

export const CHANGE_REQUEST_MERGE_METHODS = ['merge', 'squash', 'rebase'] as const
export type ChangeRequestMergeMethod = (typeof CHANGE_REQUEST_MERGE_METHODS)[number]

export type ChangeRequestCheckStatus =
  | 'pending'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'unknown'

export interface VcsChangeRequestCheck {
  readonly name: string
  readonly status: ChangeRequestCheckStatus
  readonly url: string | null
}

export interface VcsChangeRequestFile {
  readonly path: string
  readonly additions: number
  readonly deletions: number
}

export type ChangeRequestReviewDecision =
  | 'approved'
  | 'changes-requested'
  | 'review-required'
  | 'none'
  | 'unknown'

export type ChangeRequestMergeability = 'mergeable' | 'conflicting' | 'blocked' | 'unknown'

export interface ChangeRequestMergeAvailability {
  readonly allowed: boolean
  readonly reason: string | null
  readonly methods: readonly ChangeRequestMergeMethod[]
}

/** Provider-neutral, bounded lifecycle detail shown by the in-app request inspector. */
export interface VcsChangeRequestDetails extends VcsChangeRequest {
  /** Provider-local immutable display reference (GitHub number / GitLab IID). */
  readonly reference: string
  /** Exact head commit used to make merge confirmation safe against a moving branch. */
  readonly headCommit: string | null
  readonly author: string | null
  readonly changedFiles: number | null
  readonly additions: number | null
  readonly deletions: number | null
  readonly files: readonly VcsChangeRequestFile[]
  readonly checks: readonly VcsChangeRequestCheck[]
  readonly reviewDecision: ChangeRequestReviewDecision
  readonly mergeability: ChangeRequestMergeability
  readonly commentsCount: number | null
  readonly reviewsCount: number | null
  readonly reviewThreadsCount: number | null
  readonly unresolvedReviewThreadsCount: number | null
  readonly merge: ChangeRequestMergeAvailability
}

export interface SourceControlAuthStatus {
  readonly authenticated: boolean
  readonly account: string | null
  readonly host: string | null
}

export const SOURCE_CONTROL_ERROR_CODES = [
  'cli-missing',
  'not-authenticated',
  'no-change-request',
  'cancelled',
  'invalid-target',
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
  /** GitHub owner/namespace receiving the pushed head, needed for fork-safe identity. */
  readonly headOwner?: string
  /** Full GitLab source project path, or GitHub fork path used by the REST fallback. */
  readonly headRepository?: string
  /** Omitted when the provider should use its configured default branch. */
  readonly baseRef?: string
  readonly title: string
  readonly body?: string
  readonly draft?: boolean
  /**
   * Base repository approved during the stacked-action destination preflight.
   *
   * This is produced by main from validated Git remotes; renderer payload schemas do not accept
   * it. Carrying it through the mutation keeps PR/MR creation pinned if CLI defaults or local Git
   * configuration change after the user confirms the action.
   */
  readonly targetRepository?: SourceControlRepositoryIdentity
}

/** Read-only composer planning input; mutation still uses the stacked Git action contract. */
export interface ChangeRequestPreflightPayload extends OpenChangeRequestPayload {
  readonly createFeatureBranch?: boolean
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

export interface ChangeRequestDetailsSuccess {
  readonly ok: true
  readonly changeRequest: VcsChangeRequestDetails
}

export type ChangeRequestDetailsResult = ChangeRequestDetailsSuccess | SourceControlFailure

/** Session-bound snapshot consumed by the in-app PR/MR inspector. */
export interface ChangeRequestPanelSnapshot {
  readonly provider: SourceControlProviderInfo
  readonly currentRef: string | null
  readonly changeRequests: readonly VcsChangeRequest[]
  readonly selected: VcsChangeRequestDetails
}

export interface ChangeRequestPanelSuccess {
  readonly ok: true
  readonly snapshot: ChangeRequestPanelSnapshot
}

export type ChangeRequestPanelResult = ChangeRequestPanelSuccess | SourceControlFailure

export interface MergeChangeRequestPayload {
  readonly url: string
  readonly expectedHeadCommit: string
  readonly method: ChangeRequestMergeMethod
}

export interface MergeChangeRequestSuccess {
  readonly ok: true
  readonly changeRequest: VcsChangeRequestDetails
}

export type MergeChangeRequestResult = MergeChangeRequestSuccess | SourceControlFailure

export interface ChangeRequestCheckoutSuccess {
  readonly ok: true
  readonly reference: string
}

/** Result of checking a change request out into a working tree / Session worktree. */
export type ChangeRequestCheckoutResult = ChangeRequestCheckoutSuccess | SourceControlFailure

/** Read-only provider and browser readiness for the change-request composer. */
export interface ChangeRequestPreflightResult {
  readonly provider: SourceControlProviderInfo | null
  readonly readiness: SourceControlAuthResult
  readonly browserUrl: string | null
  /** Exact collision-free head ref the mutation will use. */
  readonly plannedHeadRef: string
}
