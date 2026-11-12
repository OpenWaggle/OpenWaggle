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
  return boundedObjects(value).flatMap((entry) => {
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
}

function mapMergeability(record: GlabFields): ChangeRequestMergeability {
  if (record.has_conflicts === true) return 'conflicting'
  const status = (
    asString(record.detailed_merge_status) ?? asString(record.merge_status)
  )?.toLowerCase()
  if (status === 'conflict' || status === 'cannot_be_merged') return 'conflicting'
  if (status === 'mergeable' || status === 'can_be_merged') return 'mergeable'
  if (status === 'unchecked' || !status) return 'unknown'
  return 'blocked'
}

function mapReviewDecision(record: GlabFields): ChangeRequestReviewDecision {
  if (record.approved === true || asNumericCount(record.approvals_left) === 0) {
    return 'approved'
  }
  if ((asNumericCount(record.approvals_left) ?? 0) > 0) return 'review-required'
  return 'none'
}

function pipelineChecks(record: GlabFields): readonly VcsChangeRequestCheck[] {
  const object = asObject(record.head_pipeline)
  if (!object) return []
  const pipeline: UncheckedFields<GlabPipeline> = object
  return [
    {
      name: asString(pipeline.name) ?? asString(pipeline.ref) ?? 'Pipeline',
      status: mapPipelineStatus(pipeline.status),
      url: asString(pipeline.web_url),
    },
  ]
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
export function mapGlabMergeRequestDetails(raw: unknown): VcsChangeRequestDetails | null {
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
  return {
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
}
