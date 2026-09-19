import type { ChangeRequestState, VcsChangeRequest } from '@shared/types/git'
import { asObject, asString } from './change-request-parse-shared'

/** Map a GitHub PR JSON object (from `gh pr view --json ...`) to a request summary. */
export function mapGhPullRequest(raw: unknown): VcsChangeRequest | null {
  const record = asObject(raw)
  const url = asString(record?.url)
  const title = asString(record?.title)
  if (!record || !url || title === null) return null
  return {
    title,
    url,
    baseRef: asString(record.baseRefName) ?? '',
    headRef: asString(record.headRefName) ?? '',
    state: mapGhState(asString(record.state), record.isDraft === true),
  }
}

/** Map a GitLab MR JSON object (from `glab mr view -F json`) to a request summary. */
export function mapGlabMergeRequest(raw: unknown): VcsChangeRequest | null {
  const record = asObject(raw)
  const url = asString(record?.web_url)
  const title = asString(record?.title)
  if (!record || !url || title === null) return null
  return {
    title,
    url,
    baseRef: asString(record.target_branch) ?? '',
    headRef: asString(record.source_branch) ?? '',
    state: mapGlabState(
      asString(record.state),
      record.draft === true || record.work_in_progress === true,
    ),
  }
}

export function mapGhState(state: string | null, isDraft: boolean): ChangeRequestState {
  if (isDraft) return 'draft'
  const upper = state?.toUpperCase()
  if (upper === 'MERGED') return 'merged'
  if (upper === 'CLOSED') return 'closed'
  return 'open'
}

export function mapGlabState(state: string | null, isDraft: boolean): ChangeRequestState {
  const lower = state?.toLowerCase()
  if (lower === 'merged') return 'merged'
  if (lower === 'closed') return 'closed'
  if (isDraft) return 'draft'
  return 'open'
}
