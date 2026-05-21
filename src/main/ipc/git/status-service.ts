import type { GitStatusSummary } from '@shared/types/git'
import { isGitRepository, runGit } from './shared'
import { DIFF_GIT_MAX_BUFFER, GIT_PARSE_INT_RADIX } from './status-constants'
import {
  buildChangedFiles,
  mergeDiffsByPath,
  parseNumstat,
  parsePorcelain,
  parseUnifiedDiff,
} from './status-parse'

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

export async function getGitDiff(projectPath: string) {
  await assertGitRepository(projectPath)
  const hasHead = await runGit(projectPath, ['rev-parse', '--verify', 'HEAD'])
  return hasHead.code === 0 ? getHeadDiff(projectPath) : getInitialCommitDiff(projectPath)
}

async function assertGitRepository(projectPath: string) {
  if (!(await isGitRepository(projectPath))) {
    throw new Error('Selected folder is not a Git repository.')
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

async function getHeadDiff(projectPath: string) {
  const headResult = await runGit(
    projectPath,
    ['diff', '--patch', '--find-renames', '--no-ext-diff', 'HEAD'],
    { maxBuffer: DIFF_GIT_MAX_BUFFER },
  )
  if (headResult.code !== 0) throw new Error(headResult.stderr.trim() || 'Failed to load Git diff.')
  return headResult.stdout.trim() ? parseUnifiedDiff(headResult.stdout) : []
}

async function getInitialCommitDiff(projectPath: string) {
  const [worktreeResult, cachedResult] = await Promise.all([
    runGit(projectPath, ['diff', '--patch', '--no-ext-diff'], { maxBuffer: DIFF_GIT_MAX_BUFFER }),
    runGit(projectPath, ['diff', '--patch', '--cached', '--no-ext-diff'], {
      maxBuffer: DIFF_GIT_MAX_BUFFER,
    }),
  ])

  if (worktreeResult.code !== 0 && cachedResult.code !== 0) {
    throw new Error(
      worktreeResult.stderr.trim() || cachedResult.stderr.trim() || 'Failed to load Git diff.',
    )
  }

  const parsed = [
    ...parseUnifiedDiff(worktreeResult.stdout),
    ...parseUnifiedDiff(cachedResult.stdout),
  ]
  return parsed.length === 0 ? [] : mergeDiffsByPath(parsed)
}
