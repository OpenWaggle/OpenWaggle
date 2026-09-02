import type { GitBranchInfo, GitBranchListResult } from '@shared/types/git'
import { isGitRepository, runGit } from './shared'

const PARSE_INT_ARG_2 = 10
const REFLOG_TIMESTAMP_CAPTURE_INDEX = 2

interface ParsedBranchRef {
  readonly branch: GitBranchInfo
  readonly tipCommittedAt: number
  readonly createdAt: number
}

function parseTrackCounts(track: string) {
  const aheadMatch = /ahead (\d+)/.exec(track)
  const behindMatch = /behind (\d+)/.exec(track)
  return {
    ahead: aheadMatch ? Number.parseInt(aheadMatch[1] ?? '0', PARSE_INT_ARG_2) || 0 : 0,
    behind: behindMatch ? Number.parseInt(behindMatch[1] ?? '0', PARSE_INT_ARG_2) || 0 : 0,
  }
}

function parseBranchRefLine(line: string): ParsedBranchRef {
  const [fullName = '', shortName = '', upstream = '', headMark = '', track = '', timestamp = ''] =
    line.split('\t')
  const { ahead, behind } = parseTrackCounts(track)
  const tipCommittedAt = Number.parseInt(timestamp, PARSE_INT_ARG_2)
  if (!Number.isFinite(tipCommittedAt)) {
    throw new Error(`Git returned an invalid commit timestamp for ${shortName || fullName}.`)
  }

  return {
    branch: {
      fullName,
      name: shortName,
      isRemote: fullName.startsWith('refs/remotes/'),
      isCurrent: headMark.trim() === '*',
      upstream: upstream || null,
      ahead,
      behind,
    },
    tipCommittedAt,
    createdAt: tipCommittedAt,
  }
}

function parseBranchCreationTimes(stdout: string) {
  const createdAtByFullName = new Map<string, number>()
  for (const line of stdout.split('\n')) {
    const match = /^(refs\/(?:heads|remotes)\/[^@]+)@\{(\d+)\}$/.exec(line.trim())
    if (!match) continue
    const fullName = match[1]
    const timestamp = Number.parseInt(match[REFLOG_TIMESTAMP_CAPTURE_INDEX] ?? '', PARSE_INT_ARG_2)
    if (!fullName || !Number.isFinite(timestamp)) continue
    const existing = createdAtByFullName.get(fullName)
    if (existing === undefined || timestamp < existing) {
      createdAtByFullName.set(fullName, timestamp)
    }
  }
  return createdAtByFullName
}

function sortBranchRefs(left: ParsedBranchRef, right: ParsedBranchRef) {
  if (left.branch.isRemote !== right.branch.isRemote) {
    return left.branch.isRemote ? 1 : -1
  }

  if (!left.branch.isRemote) {
    const leftIsMain = left.branch.name === 'main'
    const rightIsMain = right.branch.name === 'main'
    if (leftIsMain !== rightIsMain) {
      return leftIsMain ? -1 : 1
    }
  }

  const newestFirst = right.createdAt - left.createdAt
  if (newestFirst !== 0) {
    return newestFirst
  }

  return left.branch.name.localeCompare(right.branch.name)
}

export async function listGitBranches(projectPath: string): Promise<GitBranchListResult> {
  if (!(await isGitRepository(projectPath))) {
    throw new Error('Selected folder is not a Git repository.')
  }

  const [currentResult, refsResult, reflogResult] = await Promise.all([
    runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(projectPath, [
      'for-each-ref',
      '--format=%(refname)%09%(refname:short)%09%(upstream:short)%09%(HEAD)%09%(upstream:track)%09%(committerdate:unix)',
      'refs/heads',
      'refs/remotes',
    ]),
    // Git refs have no portable creation field. The oldest reflog entry is the
    // closest local creation record; repositories without reflogs fall back to
    // the tip commit date already returned by for-each-ref.
    runGit(projectPath, ['reflog', 'show', '--all', '--date=unix', '--format=%gD']),
  ])
  const currentBranchRaw = currentResult.code === 0 ? currentResult.stdout.trim() : ''
  const currentBranch = currentBranchRaw && currentBranchRaw !== 'HEAD' ? currentBranchRaw : null
  if (refsResult.code !== 0) {
    throw new Error(refsResult.stderr.trim() || 'Failed to load Git branches.')
  }
  const createdAtByFullName =
    reflogResult.code === 0
      ? parseBranchCreationTimes(reflogResult.stdout)
      : new Map<string, number>()

  return {
    currentBranch,
    branches: refsResult.stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map(parseBranchRefLine)
      .map((entry) => ({
        ...entry,
        createdAt: createdAtByFullName.get(entry.branch.fullName) ?? entry.tipCommittedAt,
      }))
      .filter((entry) => !entry.branch.name.endsWith('/HEAD'))
      .sort(sortBranchRefs)
      .map((entry) => entry.branch),
  }
}
