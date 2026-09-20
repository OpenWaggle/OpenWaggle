import type {
  ChangeRequestCheckStatus,
  ChangeRequestMergeability,
  ChangeRequestReviewDecision,
  ChangeRequestState,
  VcsChangeRequestCheck,
  VcsChangeRequestDetails,
  VcsChangeRequestFile,
} from '@shared/types/git'
import {
  asCount,
  asObject,
  asString,
  boundedObjects,
  CHANGE_REQUEST_MERGE_METHODS,
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

function mapCheckStatus(record: ReturnType<typeof asObject>): ChangeRequestCheckStatus {
  if (!record) return 'unknown'
  const state = (asString(record.state) ?? asString(record.status))?.toUpperCase()
  const conclusion = asString(record.conclusion)?.toUpperCase()
  const stateStatus = state ? STATE_STATUS.get(state) : undefined
  if (stateStatus === 'pending') return stateStatus
  const conclusionStatus = conclusion ? CONCLUSION_STATUS.get(conclusion) : undefined
  return conclusionStatus ?? stateStatus ?? 'unknown'
}

function mapChecks(value: unknown): readonly VcsChangeRequestCheck[] {
  return boundedObjects(value).flatMap((record) => {
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
  return boundedObjects(value).flatMap((record) => {
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

function mapMergeability(record: ReturnType<typeof asObject>): ChangeRequestMergeability {
  const mergeable = asString(record?.mergeable)?.toUpperCase()
  const status = asString(record?.mergeStateStatus)?.toUpperCase()
  if (mergeable === 'CONFLICTING' || status === 'DIRTY') return 'conflicting'
  if (status === 'BLOCKED' || status === 'BEHIND' || status === 'UNSTABLE') return 'blocked'
  if (mergeable === 'MERGEABLE') return 'mergeable'
  return 'unknown'
}

function mergeReason(input: {
  readonly state: ChangeRequestState
  readonly headCommit: string | null
  readonly checks: readonly VcsChangeRequestCheck[]
  readonly reviewDecision: ChangeRequestReviewDecision
  readonly mergeability: ChangeRequestMergeability
  readonly mergeStateStatus: string | null
}) {
  if (input.state === 'draft') return 'Mark this pull request ready for review before merging.'
  if (input.state !== 'open') return 'Only an open pull request can be merged.'
  if (!input.headCommit) return 'The head commit is unavailable. Refresh before merging.'
  if (input.mergeability === 'conflicting') return 'Resolve merge conflicts before merging.'
  if (input.mergeability === 'unknown') return 'Mergeability is still being calculated.'
  if (input.reviewDecision === 'changes-requested') {
    return 'Resolve requested review changes before merging.'
  }
  if (input.reviewDecision === 'review-required') return 'Required review approval is missing.'
  if (input.checks.some((check) => check.status === 'failed' || check.status === 'cancelled')) {
    return 'Fix failing checks before merging.'
  }
  if (input.checks.some((check) => check.status === 'pending')) {
    return 'Wait for all checks to finish before merging.'
  }
  if (
    input.mergeability === 'blocked' ||
    (input.mergeStateStatus !== null && input.mergeStateStatus !== 'CLEAN')
  ) {
    return 'Repository rules currently block this merge.'
  }
  return null
}

/** Map one bounded `gh pr view --json` response into lifecycle detail. */
export function mapGhPullRequestDetails(raw: unknown): VcsChangeRequestDetails | null {
  const record = asObject(raw)
  const summary = mapGhPullRequest(raw)
  const reference = asCount(record?.number)
  if (!record || !summary || reference === null) return null
  const checks = mapChecks(record.statusCheckRollup)
  const reviewDecision = mapReviewDecision(record.reviewDecision)
  const mergeability = mapMergeability(record)
  const headCommit = asString(record.headRefOid)
  const mergeStateStatus = asString(record.mergeStateStatus)?.toUpperCase() ?? null
  const reason = mergeReason({
    state: summary.state,
    headCommit,
    checks,
    reviewDecision,
    mergeability,
    mergeStateStatus,
  })
  return {
    ...summary,
    reference: String(reference),
    headCommit,
    author: asString(asObject(record.author)?.login),
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
