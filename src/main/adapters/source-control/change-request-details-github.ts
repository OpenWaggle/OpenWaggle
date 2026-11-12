import type {
  ChangeRequestCheckStatus,
  ChangeRequestMergeability,
  ChangeRequestReviewDecision,
  VcsChangeRequestCheck,
  VcsChangeRequestDetails,
  VcsChangeRequestFile,
} from '@shared/types/git'
import type { UncheckedFields } from '@shared/types/unchecked-fields'
import { uncheckedFields } from '@shared/utils/object-shape'
import {
  asCount,
  asObject,
  asString,
  boundedObjects,
  CHANGE_REQUEST_MERGE_METHODS,
  changeRequestMergeBlocker,
} from './change-request-parse-shared'
import { mapGhPullRequest } from './change-request-summary-parse'

const STATE_STATUS = new Map<string, ChangeRequestCheckStatus>([
  ['PENDING', 'pending'],
  ['EXPECTED', 'pending'],
  ['QUEUED', 'pending'],
  ['IN_PROGRESS', 'pending'],
  ['WAITING', 'pending'],
  ['REQUESTED', 'pending'],
  ['SUCCESS', 'passed'],
  ['ERROR', 'failed'],
  ['FAILURE', 'failed'],
])
const CONCLUSION_STATUS = new Map<string, ChangeRequestCheckStatus>([
  ['SUCCESS', 'passed'],
  ['SKIPPED', 'skipped'],
  ['NEUTRAL', 'skipped'],
  ['CANCELLED', 'cancelled'],
  ['FAILURE', 'failed'],
  ['TIMED_OUT', 'failed'],
  ['ACTION_REQUIRED', 'failed'],
  ['STARTUP_FAILURE', 'failed'],
  ['STALE', 'failed'],
])

/** The `gh pr view --json` fields lifecycle detail reads; each is checked where it is read. */
interface GhPullRequestDetails {
  readonly number: number
  readonly statusCheckRollup: readonly GhStatusCheck[]
  readonly reviewDecision: string
  readonly mergeable: string
  readonly mergeStateStatus: string
  readonly headRefOid: string
  readonly author: { readonly login: string }
  readonly changedFiles: number
  readonly additions: number
  readonly deletions: number
  readonly files: readonly GhPullRequestFile[]
  readonly comments: readonly unknown[]
  readonly latestReviews: readonly unknown[]
}

/** A check run (`status`, `conclusion`, `name`) or a commit status (`state`, `context`). */
interface GhStatusCheck {
  readonly state: string
  readonly status: string
  readonly conclusion: string
  readonly name: string
  readonly context: string
  readonly detailsUrl: string
  readonly targetUrl: string
}

interface GhPullRequestFile {
  readonly path: string
  readonly additions: number
  readonly deletions: number
}

function mapCheckStatus(record: UncheckedFields<GhStatusCheck>): ChangeRequestCheckStatus {
  const state = (asString(record.state) ?? asString(record.status))?.toUpperCase()
  const conclusion = asString(record.conclusion)?.toUpperCase()
  const stateStatus = state ? STATE_STATUS.get(state) : undefined
  if (stateStatus === 'pending') return stateStatus
  const conclusionStatus = conclusion ? CONCLUSION_STATUS.get(conclusion) : undefined
  return conclusionStatus ?? stateStatus ?? 'unknown'
}

function mapChecks(value: unknown): readonly VcsChangeRequestCheck[] {
  return boundedObjects(value).flatMap((entry) => {
    const record: UncheckedFields<GhStatusCheck> = entry
    const name = asString(record.name) ?? asString(record.context)
    if (!name) return []
    return [
      {
        name,
        status: mapCheckStatus(record),
        url: asString(record.detailsUrl) ?? asString(record.targetUrl),
      },
    ]
  })
}

function mapFiles(value: unknown): readonly VcsChangeRequestFile[] {
  return boundedObjects(value).flatMap((entry) => {
    const record: UncheckedFields<GhPullRequestFile> = entry
    const path = asString(record.path)
    if (!path) return []
    return [
      {
        path,
        additions: asCount(record.additions) ?? 0,
        deletions: asCount(record.deletions) ?? 0,
      },
    ]
  })
}

function mapReviewDecision(value: unknown): ChangeRequestReviewDecision {
  const decision = asString(value)?.toUpperCase()
  if (decision === 'APPROVED') return 'approved'
  if (decision === 'CHANGES_REQUESTED') return 'changes-requested'
  if (decision === 'REVIEW_REQUIRED') return 'review-required'
  if (value === null || value === undefined || decision === '') return 'none'
  return 'unknown'
}

function mapMergeability(record: UncheckedFields<GhPullRequestDetails>): ChangeRequestMergeability {
  const mergeable = asString(record.mergeable)?.toUpperCase()
  const status = asString(record.mergeStateStatus)?.toUpperCase()
  if (mergeable === 'CONFLICTING' || status === 'DIRTY') return 'conflicting'
  if (status === 'BLOCKED' || status === 'BEHIND' || status === 'UNSTABLE') return 'blocked'
  if (mergeable === 'MERGEABLE') return 'mergeable'
  return 'unknown'
}

/** Map one bounded `gh pr view --json` response into lifecycle detail. */
export function mapGhPullRequestDetails(raw: unknown): VcsChangeRequestDetails | null {
  const object = asObject(raw)
  const summary = mapGhPullRequest(raw)
  if (!object || !summary) return null
  const record: UncheckedFields<GhPullRequestDetails> = object
  const reference = asCount(record.number)
  if (reference === null) return null
  const checks = mapChecks(record.statusCheckRollup)
  const reviewDecision = mapReviewDecision(record.reviewDecision)
  const mergeability = mapMergeability(record)
  const headCommit = asString(record.headRefOid)
  const mergeStateStatus = asString(record.mergeStateStatus)?.toUpperCase() ?? null
  const reason = changeRequestMergeBlocker({
    noun: 'pull request',
    state: summary.state,
    headCommit,
    checks,
    reviewDecision,
    mergeability,
    rulesBlocked: mergeStateStatus !== null && mergeStateStatus !== 'CLEAN',
  })
  return {
    ...summary,
    reference: String(reference),
    headCommit,
    author: asString(uncheckedFields<GhPullRequestDetails['author']>(record.author).login),
    changedFiles: asCount(record.changedFiles),
    additions: asCount(record.additions),
    deletions: asCount(record.deletions),
    files: mapFiles(record.files),
    checks,
    reviewDecision,
    mergeability,
    commentsCount: Array.isArray(record.comments) ? record.comments.length : null,
    reviewsCount: Array.isArray(record.latestReviews) ? record.latestReviews.length : null,
    reviewThreadsCount: null,
    unresolvedReviewThreadsCount: null,
    merge: { allowed: reason === null, reason, methods: CHANGE_REQUEST_MERGE_METHODS },
  }
}
