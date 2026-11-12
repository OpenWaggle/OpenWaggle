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
export function mapGhPullRequest(raw: unknown): VcsChangeRequest | null {
  const object = asObject(raw)
  if (!object) return null
  const record: UncheckedFields<GhPullRequestSummary> = object
  const url = asString(record.url)
  const title = asString(record.title)
  if (!url || title === null) return null
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
  const object = asObject(raw)
  if (!object) return null
  const record: UncheckedFields<GlabMergeRequestSummary> = object
  const url = asString(record.web_url)
  const title = asString(record.title)
  if (!url || title === null) return null
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
