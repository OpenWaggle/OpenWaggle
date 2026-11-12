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
  asNumericCount,
  asObject,
  asString,
  boundedObjects,
  CHANGE_REQUEST_MERGE_METHODS,
  changeRequestMergeBlocker,
  MAX_CHANGE_REQUEST_ITEMS,
} from './change-request-parse-shared'
import { mapGlabMergeRequest } from './change-request-summary-parse'

/** The `glab mr view -F json --comments` fields lifecycle detail reads; each is checked where read. */
interface GlabMergeRequestDetails {
  readonly iid: number | string
  readonly diff_stats: readonly GlabFileStats[]
  readonly changes: readonly GlabFileStats[]
  readonly has_conflicts: boolean
  readonly detailed_merge_status: string
  readonly merge_status: string
  readonly approved: boolean
  readonly approvals_left: number | string
  readonly head_pipeline: GlabPipeline
  readonly discussions: readonly { readonly resolved: boolean }[]
  readonly sha: string
  readonly author: { readonly username: string; readonly name: string }
  readonly changes_count: number | string
  readonly user_notes_count: number | string
}

interface GlabFileStats {
  readonly path: string
  readonly new_path: string
  readonly additions: number | string
  readonly deletions: number | string
}

interface GlabPipeline {
  readonly name: string
  readonly ref: string
  readonly status: string
  readonly web_url: string
}

type GlabFields = UncheckedFields<GlabMergeRequestDetails>

function mapPipelineStatus(value: unknown) {
  const status = asString(value)?.toLowerCase()
  if (status === 'success' || status === 'passed') {
    const result: ChangeRequestCheckStatus = 'passed'
    return result
  }
  if (status === 'failed') {
    const result: ChangeRequestCheckStatus = 'failed'
    return result
  }
  if (status === 'canceled' || status === 'cancelled') {
    const result: ChangeRequestCheckStatus = 'cancelled'
    return result
  }
  if (status === 'skipped' || status === 'manual') {
    const result: ChangeRequestCheckStatus = 'skipped'
    return result
  }
  if (status === 'created' || status === 'waiting_for_resource' || status === 'preparing') {
    const result: ChangeRequestCheckStatus = 'pending'
    return result
  }
  if (status === 'pending' || status === 'running' || status === 'scheduled') {
    const result: ChangeRequestCheckStatus = 'pending'
    return result
  }
  const result: ChangeRequestCheckStatus = 'unknown'
  return result
}

function mapFiles(value: unknown) {
  const file: readonly VcsChangeRequestFile[] = boundedObjects(value).flatMap((entry) => {
    const record: UncheckedFields<GlabFileStats> = entry
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
  return file
}

function mapMergeability(record: GlabFields) {
  if (record.has_conflicts === true) {
    const mergeability: ChangeRequestMergeability = 'conflicting'
    return mergeability
  }
  const status = (
    asString(record.detailed_merge_status) ?? asString(record.merge_status)
  )?.toLowerCase()
  if (status === 'conflict' || status === 'cannot_be_merged') {
    const mergeability: ChangeRequestMergeability = 'conflicting'
    return mergeability
  }
  if (status === 'mergeable' || status === 'can_be_merged') {
    const mergeability: ChangeRequestMergeability = 'mergeable'
    return mergeability
  }
  if (status === 'unchecked' || !status) {
    const mergeability: ChangeRequestMergeability = 'unknown'
    return mergeability
  }
  const mergeability: ChangeRequestMergeability = 'blocked'
  return mergeability
}

function mapReviewDecision(record: GlabFields) {
  if (record.approved === true || asNumericCount(record.approvals_left) === 0) {
    const decision: ChangeRequestReviewDecision = 'approved'
    return decision
  }
  if ((asNumericCount(record.approvals_left) ?? 0) > 0) {
    const decision: ChangeRequestReviewDecision = 'review-required'
    return decision
  }
  const decision: ChangeRequestReviewDecision = 'none'
  return decision
}

function pipelineChecks(record: GlabFields) {
  const object = asObject(record.head_pipeline)
  if (!object) {
    const check: readonly VcsChangeRequestCheck[] = []
    return check
  }
  const pipeline: UncheckedFields<GlabPipeline> = object
  const check: readonly VcsChangeRequestCheck[] = [
    {
      name: asString(pipeline.name) ?? asString(pipeline.ref) ?? 'Pipeline',
      status: mapPipelineStatus(pipeline.status),
      url: asString(pipeline.web_url),
    },
  ]
  return check
}

function discussionCounts(record: GlabFields) {
  const discussions = boundedObjects(record.discussions)
  const complete =
    Array.isArray(record.discussions) && record.discussions.length < MAX_CHANGE_REQUEST_ITEMS
  if (!complete) return { reviewThreadsCount: null, unresolvedReviewThreadsCount: null }
  return {
    reviewThreadsCount: discussions.length,
    unresolvedReviewThreadsCount: discussions.filter(
      (discussion) => uncheckedFields<{ readonly resolved: boolean }>(discussion).resolved !== true,
    ).length,
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
export function mapGlabMergeRequestDetails(raw: unknown) {
  const object = asObject(raw)
  const summary = mapGlabMergeRequest(raw)
  if (!object || !summary) return null
  const record: GlabFields = object
  const reference = asNumericCount(record.iid)
  if (reference === null) return null
  const files = mapFiles(record.diff_stats ?? record.changes)
  const fallbackTotals = fileTotals(files)
  const checks = pipelineChecks(record)
  const reviewDecision = mapReviewDecision(record)
  const mergeability = mapMergeability(record)
  const headCommit = asString(record.sha)
  const reason = changeRequestMergeBlocker({
    noun: 'merge request',
    state: summary.state,
    headCommit,
    checks,
    reviewDecision,
    mergeability,
    rulesBlocked: false,
  })
  const details: VcsChangeRequestDetails | null = {
    ...summary,
    reference: String(reference),
    headCommit,
    author:
      asString(uncheckedFields<GlabMergeRequestDetails['author']>(record.author).username) ??
      asString(uncheckedFields<GlabMergeRequestDetails['author']>(record.author).name),
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
  return details
}
