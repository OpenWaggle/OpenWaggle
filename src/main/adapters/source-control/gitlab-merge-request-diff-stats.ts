import type {
  SourceControlRepositoryIdentity,
  VcsChangeRequestDetails,
  VcsChangeRequestFile,
} from '@shared/types/git'
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function loadDiffPage(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  reference: string,
  page: number,
): Promise<DiffPageResult> {
  const result = await runCli(
    'glab',
    ['api', diffsEndpoint(repository, reference, page), '--hostname', repository.host],
    projectPath,
  )
  if (result.missing) return { ok: false, reason: 'cli-missing', exitCode: result.code }
  if (result.code !== 0) return { ok: false, reason: 'cli-failed', exitCode: result.code }
  const parsed = parseJson(result.stdout)
  if (!Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid-response', exitCode: result.code }
  }
  return { ok: true, entries: parsed }
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
): Promise<DiffEntriesResult> {
  const entries: unknown[] = []
  for (let page = FIRST_DIFF_PAGE; page <= MAX_GITLAB_DIFF_PAGES; page += 1) {
    const result = await loadDiffPage(repository, projectPath, reference, page)
    if (!result.ok) return result
    // Bound each page even if the server ignores `per_page`.
    entries.push(...result.entries.slice(0, MAX_CHANGE_REQUEST_ITEMS))
    if (result.entries.length < MAX_CHANGE_REQUEST_ITEMS) {
      return { ok: true, entries, complete: true }
    }
  }
  return { ok: true, entries, complete: false }
}

interface DiffFile extends VcsChangeRequestFile {
  /** GitLab withheld this file's diff body, so its line counts are unknown. */
  readonly omitted: boolean
}

function diffFiles(entries: readonly unknown[]): readonly DiffFile[] {
  return entries.flatMap((raw) => {
    const entry = asObject(raw)
    if (!entry) return []
    const path = asString(entry.new_path) ?? asString(entry.old_path)
    if (!path) return []
    const diff = asString(entry.diff)
    const omitted = entry.too_large === true || (entry.collapsed === true && diff === null)
    return [{ path, ...countDiffLines(diff ?? ''), omitted }]
  })
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
): Promise<VcsChangeRequestDetails> {
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
  return {
    ...details,
    changedFiles: details.changedFiles ?? (diffs.complete ? files.length : null),
    files: files
      .slice(0, MAX_CHANGE_REQUEST_ITEMS)
      .map(({ path, additions, deletions }) => ({ path, additions, deletions })),
    ...diffTotals(files, diffs.complete),
  }
}
