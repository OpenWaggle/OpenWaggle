import type { GitDiffFailure, GitDiffResult, GitStatusSummary } from '@shared/types/git'
import type { GitExecResult } from '../../adapters/git/run-git'
import { resolveDefaultBranchRevision } from './default-ref'
import { isGitRepository, runGit } from './shared'
import { DIFF_GIT_MAX_BUFFER, GIT_PARSE_INT_RADIX } from './status-constants'
import {
  buildChangedFiles,
  mergeDiffsByPath,
  parseNumstat,
  parsePorcelain,
  parseUnifiedDiff,
} from './status-parse'

const NOT_A_REPOSITORY_MESSAGE = 'Selected folder is not a Git repository.'
const FAILED_TO_LOAD_DIFF_MESSAGE = 'Failed to load Git diff.'
const DIFF_TOO_LARGE_MESSAGE =
  'This diff is too large to display. Commit or stage part of the change, or exclude generated files.'

interface GitStatusCommandResults {
  readonly branchResult: Awaited<ReturnType<typeof runGit>>
  readonly porcelainResult: Awaited<ReturnType<typeof runGit>>
  readonly numstatHeadResult: Awaited<ReturnType<typeof runGit>>
  readonly upstreamResult: Awaited<ReturnType<typeof runGit>>
}

export async function getGitStatus(projectPath: string) {
  await assertGitRepository(projectPath)
  const results = await loadGitStatusCommandResults(projectPath)
  const branch = await resolveBranchName(projectPath, results.branchResult)
  const aheadBehind = parseAheadBehind(results.upstreamResult)
  const numstat = await resolveNumstat(projectPath, results.numstatHeadResult)
  const changedFiles = buildChangedFiles(parsePorcelain(results.porcelainResult.stdout), numstat)

  return {
    branch,
    additions: sumChangedFiles(changedFiles, 'additions'),
    deletions: sumChangedFiles(changedFiles, 'deletions'),
    filesChanged: changedFiles.length,
    changedFiles,
    clean: changedFiles.length === 0,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
  } satisfies GitStatusSummary
}

export async function getGitDiff(projectPath: string): Promise<GitDiffResult> {
  if (!(await isGitRepository(projectPath))) {
    return { ok: false, code: 'not-git-repo', message: NOT_A_REPOSITORY_MESSAGE }
  }
  const hasHead = await runGit(projectPath, ['rev-parse', '--verify', 'HEAD'])
  return hasHead.code === 0
    ? await getHeadDiff(projectPath)
    : await getInitialCommitDiff(projectPath)
}

/**
 * Translate a failed diff command into a typed failure.
 *
 * These paths used to throw, so the working-tree scope surfaced a raw IPC rejection where the
 * branch scope returned a typed failure for the very same condition. An over-large diff is
 * enough to trigger it: git's output exceeding the buffer normalises to `code: 1` with empty
 * stderr, so the message would not even have said what went wrong.
 */
function diffCommandFailure(result: GitExecResult, fallback: string): GitDiffFailure {
  if (result.maxBufferExceeded === true) {
    return {
      ok: false,
      code: 'diff-too-large',
      message: DIFF_TOO_LARGE_MESSAGE,
    }
  }
  return { ok: false, code: 'unknown', message: result.stderr.trim() || fallback }
}

/**
 * Branch diff: changes on HEAD relative to the merge-base with a base ref (three-dot diff).
 *
 * An empty base ref means the panel's "Automatic" option, which resolves to the repository's
 * default branch. It used to fall through to the working-tree diff, which made Automatic a
 * silent duplicate of the Working tree scope while the label promised a decision (#157).
 * When no default branch can be resolved - a fresh repository with no remote and no created
 * default branch - the working-tree diff remains the only honest answer.
 */
export async function getGitBranchDiff(
  projectPath: string,
  baseRef: string,
): Promise<GitDiffResult> {
  if (!(await isGitRepository(projectPath))) {
    return { ok: false, code: 'not-git-repo', message: NOT_A_REPOSITORY_MESSAGE }
  }
  const requested = baseRef.trim()
  const automatic = requested === ''
  const trimmed = automatic ? await resolveDefaultBranchRevision(projectPath) : requested
  if (trimmed === null || trimmed === '') {
    // Say so rather than passing off a working-tree diff as a branch diff.
    const fallback = await getGitDiff(projectPath)
    return fallback.ok && automatic
      ? { ...fallback, automaticFellBackToWorkingTree: true }
      : fallback
  }

  const verify = await runGit(projectPath, ['rev-parse', '--verify', `${trimmed}^{commit}`])
  if (verify.code !== 0) {
    return {
      ok: false,
      code: 'bad-revision',
      message: `Base ref "${trimmed}" could not be resolved.`,
    }
  }
  const result = await runGit(
    projectPath,
    ['diff', '--patch', '--find-renames', '--no-ext-diff', `${trimmed}...HEAD`],
    { maxBuffer: DIFF_GIT_MAX_BUFFER },
  )
  if (result.code !== 0) {
    return diffCommandFailure(result, 'Failed to load branch diff.')
  }
  return {
    ok: true,
    files: result.stdout.trim() ? parseUnifiedDiff(result.stdout) : [],
    // Only report a ref the caller did not choose: Automatic has to be auditable.
    ...(automatic ? { resolvedBaseRef: trimmed } : {}),
  }
}

async function assertGitRepository(projectPath: string) {
  if (!(await isGitRepository(projectPath))) {
    throw new Error(NOT_A_REPOSITORY_MESSAGE)
  }
}

async function loadGitStatusCommandResults(projectPath: string): Promise<GitStatusCommandResults> {
  const [branchResult, porcelainResult, numstatHeadResult, upstreamResult] = await Promise.all([
    runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(projectPath, ['status', '--porcelain=v1']),
    runGit(projectPath, ['diff', '--numstat', 'HEAD']),
    runGit(projectPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']),
  ])
  return { branchResult, porcelainResult, numstatHeadResult, upstreamResult }
}

async function resolveBranchName(
  projectPath: string,
  branchResult: Awaited<ReturnType<typeof runGit>>,
) {
  const branch = branchResult.stdout.trim() || 'unknown'
  if (branch !== 'HEAD') return branch

  const hashResult = await runGit(projectPath, ['rev-parse', '--short', 'HEAD'])
  return hashResult.code === 0 ? `detached@${hashResult.stdout.trim()}` : branch
}

function parseAheadBehind(upstreamResult: Awaited<ReturnType<typeof runGit>>) {
  if (upstreamResult.code !== 0) return { ahead: 0, behind: 0 }

  const [aheadStr, behindStr] = upstreamResult.stdout.trim().split('\t')
  return {
    ahead: Number.parseInt(aheadStr ?? '0', GIT_PARSE_INT_RADIX) || 0,
    behind: Number.parseInt(behindStr ?? '0', GIT_PARSE_INT_RADIX) || 0,
  }
}

async function resolveNumstat(
  projectPath: string,
  numstatHeadResult: Awaited<ReturnType<typeof runGit>>,
) {
  if (numstatHeadResult.code === 0) return parseNumstat(numstatHeadResult.stdout)

  const [worktreeResult, cachedResult] = await Promise.all([
    runGit(projectPath, ['diff', '--numstat']),
    runGit(projectPath, ['diff', '--cached', '--numstat']),
  ])
  return parseNumstat(`${worktreeResult.stdout}\n${cachedResult.stdout}`)
}

function sumChangedFiles(
  changedFiles: GitStatusSummary['changedFiles'],
  key: 'additions' | 'deletions',
) {
  return changedFiles.reduce((sum, file) => sum + file[key], 0)
}

async function getHeadDiff(projectPath: string): Promise<GitDiffResult> {
  const headResult = await runGit(
    projectPath,
    ['diff', '--patch', '--find-renames', '--no-ext-diff', 'HEAD'],
    { maxBuffer: DIFF_GIT_MAX_BUFFER },
  )
  if (headResult.code !== 0) {
    return diffCommandFailure(headResult, FAILED_TO_LOAD_DIFF_MESSAGE)
  }
  return { ok: true, files: headResult.stdout.trim() ? parseUnifiedDiff(headResult.stdout) : [] }
}

async function getInitialCommitDiff(projectPath: string): Promise<GitDiffResult> {
  const [worktreeResult, cachedResult] = await Promise.all([
    runGit(projectPath, ['diff', '--patch', '--no-ext-diff'], { maxBuffer: DIFF_GIT_MAX_BUFFER }),
    runGit(projectPath, ['diff', '--patch', '--cached', '--no-ext-diff'], {
      maxBuffer: DIFF_GIT_MAX_BUFFER,
    }),
  ])

  if (worktreeResult.code !== 0 && cachedResult.code !== 0) {
    const failing = worktreeResult.maxBufferExceeded === true ? worktreeResult : cachedResult
    return diffCommandFailure(failing, FAILED_TO_LOAD_DIFF_MESSAGE)
  }

  const parsed = [
    ...parseUnifiedDiff(worktreeResult.stdout),
    ...parseUnifiedDiff(cachedResult.stdout),
  ]
  return { ok: true, files: parsed.length === 0 ? [] : mergeDiffsByPath(parsed) }
}
