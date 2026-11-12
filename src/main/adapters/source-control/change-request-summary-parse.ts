import type { ChangeRequestState, VcsChangeRequest } from '@shared/types/git'
import type { UncheckedFields } from '@shared/types/unchecked-fields'
import { asObject, asString } from './change-request-parse-shared'

/** The `gh pr view --json` fields a summary reads; each is checked where it is read. */
interface GhPullRequestSummary {
  readonly url: string
  readonly title: string
  readonly baseRefName: string
  readonly headRefName: string
  readonly state: string
  readonly isDraft: boolean
}

/** The `glab mr view -F json` fields a summary reads. */
interface GlabMergeRequestSummary {
  readonly web_url: string
  readonly title: string
  readonly target_branch: string
  readonly source_branch: string
  readonly state: string
  readonly draft: boolean
  readonly work_in_progress: boolean
}

/** Map a GitHub PR JSON object (from `gh pr view --json ...`) to a request summary. */
export function mapGhPullRequest(raw: unknown) {
  const object = asObject(raw)
  if (!object) return null
  const record: UncheckedFields<GhPullRequestSummary> = object
  const url = asString(record.url)
  const title = asString(record.title)
  if (!url || title === null) return null
  const request: VcsChangeRequest | null = {
    title,
    url,
    baseRef: asString(record.baseRefName) ?? '',
    headRef: asString(record.headRefName) ?? '',
    state: mapGhState(asString(record.state), record.isDraft === true),
  }
  return request
}

/** Map a GitLab MR JSON object (from `glab mr view -F json`) to a request summary. */
export function mapGlabMergeRequest(raw: unknown) {
  const object = asObject(raw)
  if (!object) return null
  const record: UncheckedFields<GlabMergeRequestSummary> = object
  const url = asString(record.web_url)
  const title = asString(record.title)
  if (!url || title === null) return null
  const request: VcsChangeRequest | null = {
    title,
    url,
    baseRef: asString(record.target_branch) ?? '',
    headRef: asString(record.source_branch) ?? '',
    state: mapGlabState(
      asString(record.state),
      record.draft === true || record.work_in_progress === true,
    ),
  }
  return request
}

export function mapGhState(state: string | null, isDraft: boolean) {
  if (isDraft) {
    const result: ChangeRequestState = 'draft'
    return result
  }
  const upper = state?.toUpperCase()
  if (upper === 'MERGED') {
    const result: ChangeRequestState = 'merged'
    return result
  }
  if (upper === 'CLOSED') {
    const result: ChangeRequestState = 'closed'
    return result
  }
  const result: ChangeRequestState = 'open'
  return result
}

export function mapGlabState(state: string | null, isDraft: boolean) {
  const lower = state?.toLowerCase()
  if (lower === 'merged') {
    const result: ChangeRequestState = 'merged'
    return result
  }
  if (lower === 'closed') {
    const result: ChangeRequestState = 'closed'
    return result
  }
  if (isDraft) {
    const result: ChangeRequestState = 'draft'
    return result
  }
  const result: ChangeRequestState = 'open'
  return result
}
