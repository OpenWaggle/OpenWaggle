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
  asNumericCount,
  asObject,
  asString,
  boundedObjects,
  CHANGE_REQUEST_MERGE_METHODS,
  MAX_CHANGE_REQUEST_ITEMS,
} from './change-request-parse-shared'
import { mapGlabMergeRequest } from './change-request-summary-parse'

function mapPipelineStatus(value: unknown): ChangeRequestCheckStatus {
  const status = asString(value)?.toLowerCase()
  if (status === 'success' || status === 'passed') return 'passed'
  if (status === 'failed') return 'failed'
  if (status === 'canceled' || status === 'cancelled') return 'cancelled'
  if (status === 'skipped' || status === 'manual') return 'skipped'
  if (status === 'created' || status === 'waiting_for_resource' || status === 'preparing') {
    return 'pending'
  }
  if (status === 'pending' || status === 'running' || status === 'scheduled') return 'pending'
  return 'unknown'
}

function mapFiles(value: unknown): readonly VcsChangeRequestFile[] {
  return boundedObjects(value).flatMap((record) => {
    const path = asString(record.path) ?? asString(record.new_path)
    if (!path) return []
    return [
      {
        path,
        additions: asNumericCount(record.additions) ?? 0,
        deletions: asNumericCount(record.deletions) ?? 0,
      },
    ]
  })
}

function mapMergeability(record: ReturnType<typeof asObject>): ChangeRequestMergeability {
  if (!record) return 'unknown'
  if (record.has_conflicts === true) return 'conflicting'
  const status = (
    asString(record.detailed_merge_status) ?? asString(record.merge_status)
  )?.toLowerCase()
  if (status === 'conflict' || status === 'cannot_be_merged') return 'conflicting'
  if (status === 'mergeable' || status === 'can_be_merged') return 'mergeable'
  if (status === 'unchecked' || !status) return 'unknown'
  return 'blocked'
}

function mapReviewDecision(record: ReturnType<typeof asObject>): ChangeRequestReviewDecision {
  if (!record) return 'unknown'
  if (record.approved === true || asNumericCount(record.approvals_left) === 0) return 'approved'
  if ((asNumericCount(record.approvals_left) ?? 0) > 0) return 'review-required'
  return 'none'
}

function mergeReason(input: {
  readonly state: ChangeRequestState
  readonly headCommit: string | null
  readonly checks: readonly VcsChangeRequestCheck[]
  readonly reviewDecision: ChangeRequestReviewDecision
  readonly mergeability: ChangeRequestMergeability
}) {
  if (input.state === 'draft') return 'Mark this merge request ready for review before merging.'
  if (input.state !== 'open') return 'Only an open merge request can be merged.'
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
  if (input.mergeability === 'blocked') return 'Repository rules currently block this merge.'
  return null
}

function pipelineChecks(record: ReturnType<typeof asObject>): readonly VcsChangeRequestCheck[] {
  const pipeline = asObject(record?.head_pipeline)
  if (!pipeline) return []
  return [
    {
      name: asString(pipeline.name) ?? asString(pipeline.ref) ?? 'Pipeline',
      status: mapPipelineStatus(pipeline.status),
      url: asString(pipeline.web_url),
    },
  ]
}

function discussionCounts(record: ReturnType<typeof asObject>) {
  const discussions = boundedObjects(record?.discussions)
  const complete =
    Array.isArray(record?.discussions) && record.discussions.length < MAX_CHANGE_REQUEST_ITEMS
  if (!complete) return { reviewThreadsCount: null, unresolvedReviewThreadsCount: null }
  return {
    reviewThreadsCount: discussions.length,
    unresolvedReviewThreadsCount: discussions.filter((discussion) => discussion.resolved !== true)
      .length,
  }
}

function fileTotals(files: readonly VcsChangeRequestFile[]) {
  if (files.length === 0) return { additions: null, deletions: null, changedFiles: null }
  return {
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    changedFiles: files.length,
  }
}

/** Map one bounded `glab mr view -F json --comments` response into lifecycle detail. */
export function mapGlabMergeRequestDetails(raw: unknown): VcsChangeRequestDetails | null {
  const record = asObject(raw)
  const summary = mapGlabMergeRequest(raw)
  const reference = asNumericCount(record?.iid)
  if (!record || !summary || reference === null) return null
  const files = mapFiles(record.diff_stats ?? record.changes)
  const fallbackTotals = fileTotals(files)
  const checks = pipelineChecks(record)
  const reviewDecision = mapReviewDecision(record)
  const mergeability = mapMergeability(record)
  const headCommit = asString(record.sha)
  const reason = mergeReason({
    state: summary.state,
    headCommit,
    checks,
    reviewDecision,
    mergeability,
  })
  return {
    ...summary,
    reference: String(reference),
    headCommit,
    author: asString(asObject(record.author)?.username) ?? asString(asObject(record.author)?.name),
    changedFiles: asNumericCount(record.changes_count) ?? fallbackTotals.changedFiles,
    additions: fallbackTotals.additions,
    deletions: fallbackTotals.deletions,
    files,
    checks,
    reviewDecision,
    mergeability,
    commentsCount: asNumericCount(record.user_notes_count),
    reviewsCount: null,
    ...discussionCounts(record),
    merge: { allowed: reason === null, reason, methods: CHANGE_REQUEST_MERGE_METHODS },
  }
}
