import type {
  SourceControlRepositoryIdentity,
  VcsChangeRequestDetails,
  VcsChangeRequestFile,
} from '@shared/types/git'
import type { UncheckedFields } from '@shared/types/unchecked-fields'
import { createLogger } from '../../logger'
import { asObject, asString, MAX_CHANGE_REQUEST_ITEMS } from './change-request-parse-shared'
import { runCli } from './cli-runner'

const logger = createLogger('gitlab-merge-request-diff-stats')
/** Upper bound on diff pages fetched per merge request (each page holds up to 100 files). */
const MAX_GITLAB_DIFF_PAGES = 10
const FIRST_DIFF_PAGE = 1

interface DiffLoadFailure {
  readonly ok: false
  readonly reason: 'cli-missing' | 'cli-failed' | 'invalid-response'
  readonly exitCode: number
}

type DiffPageResult = { readonly ok: true; readonly entries: readonly unknown[] } | DiffLoadFailure

type DiffEntriesResult =
  | {
      readonly ok: true
      readonly entries: readonly unknown[]
      /** False when the page cap was reached before GitLab ran out of diffs. */
      readonly complete: boolean
    }
  | DiffLoadFailure

function diffsEndpoint(
  repository: SourceControlRepositoryIdentity,
  reference: string,
  page: number,
) {
  const project = encodeURIComponent(`${repository.owner}/${repository.repository}`)
  return `projects/${project}/merge_requests/${reference}/diffs?page=${page}&per_page=${MAX_CHANGE_REQUEST_ITEMS}`
}

function parseJson(text: string) {
  try {
    const result: unknown = JSON.parse(text)
    return result
  } catch {
    return null
  }
}

async function loadDiffPage(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  reference: string,
  page: number,
) {
  const result = await runCli(
    'glab',
    ['api', diffsEndpoint(repository, reference, page), '--hostname', repository.host],
    projectPath,
  )
  if (result.missing) {
    const value: DiffPageResult = { ok: false, reason: 'cli-missing', exitCode: result.code }
    return value
  }
  if (result.code !== 0) {
    const value: DiffPageResult = { ok: false, reason: 'cli-failed', exitCode: result.code }
    return value
  }
  const parsed = parseJson(result.stdout)
  if (!Array.isArray(parsed)) {
    const value: DiffPageResult = { ok: false, reason: 'invalid-response', exitCode: result.code }
    return value
  }
  const value: DiffPageResult = { ok: true, entries: parsed }
  return value
}

/** Count changed lines inside hunks; anything before the first `@@` (e.g. `---`/`+++`) is header. */
function countDiffLines(diff: string) {
  let additions = 0
  let deletions = 0
  let inHunk = false
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) additions += 1
    if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}

async function loadDiffEntries(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  reference: string,
) {
  const entries: unknown[] = []
  for (let page = FIRST_DIFF_PAGE; page <= MAX_GITLAB_DIFF_PAGES; page += 1) {
    const result = await loadDiffPage(repository, projectPath, reference, page)
    if (!result.ok) {
      const value: DiffEntriesResult = result
      return value
    }
    // Bound each page even if the server ignores `per_page`.
    entries.push(...result.entries.slice(0, MAX_CHANGE_REQUEST_ITEMS))
    if (result.entries.length < MAX_CHANGE_REQUEST_ITEMS) {
      const value: DiffEntriesResult = { ok: true, entries, complete: true }
      return value
    }
  }
  const value: DiffEntriesResult = { ok: true, entries, complete: false }
  return value
}

interface DiffFile extends VcsChangeRequestFile {
  /** GitLab withheld this file's diff body, so its line counts are unknown. */
  readonly omitted: boolean
}

/** A GitLab merge request diff entry, as the `diffs` API returns it. */
interface GitlabDiffEntry {
  readonly new_path: string
  readonly old_path: string
  readonly diff: string
  readonly too_large: boolean
  readonly collapsed: boolean
}

function diffFiles(entries: readonly unknown[]) {
  const file: readonly DiffFile[] = entries.flatMap((raw) => {
    const object = asObject(raw)
    if (!object) return []
    const entry: UncheckedFields<GitlabDiffEntry> = object
    const path = asString(entry.new_path) ?? asString(entry.old_path)
    if (!path) return []
    const diff = asString(entry.diff)
    const omitted = entry.too_large === true || (entry.collapsed === true && diff === null)
    return [{ path, ...countDiffLines(diff ?? ''), omitted }]
  })
  return file
}

function diffTotals(files: readonly DiffFile[], complete: boolean) {
  if (!complete || files.some((file) => file.omitted)) return { additions: null, deletions: null }
  return {
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  }
}

/**
 * Fill per-file and total diff stats that `glab mr view` omits, from the bound repository's
 * merge request diffs endpoint. Stats are best-effort: a failed lookup keeps the details as-is,
 * and totals stay unknown when the page cap or an oversized file leaves them incomplete.
 */
export async function withGitlabMergeRequestDiffStats(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  details: VcsChangeRequestDetails,
) {
  const diffs = await loadDiffEntries(repository, projectPath, details.reference)
  if (!diffs.ok) {
    logger.warn('GitLab merge request diff stats unavailable', {
      host: repository.host,
      reference: details.reference,
      reason: diffs.reason,
      exitCode: diffs.exitCode,
    })
    return details
  }
  const files = diffFiles(diffs.entries)
  const result: VcsChangeRequestDetails = {
    ...details,
    changedFiles: details.changedFiles ?? (diffs.complete ? files.length : null),
    files: files
      .slice(0, MAX_CHANGE_REQUEST_ITEMS)
      .map(({ path, additions, deletions }) => ({ path, additions, deletions })),
    ...diffTotals(files, diffs.complete),
  }
  return result
}
