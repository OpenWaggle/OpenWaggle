import type { GitBranchInfo, GitBranchListResult } from '@shared/types/git'
import { isGitRepository, runGit } from './shared'

const PARSE_INT_ARG_2 = 10

function parseTrackCounts(track: string) {
  const aheadMatch = /ahead (\d+)/.exec(track)
  const behindMatch = /behind (\d+)/.exec(track)
  return {
    ahead: aheadMatch ? Number.parseInt(aheadMatch[1] ?? '0', PARSE_INT_ARG_2) || 0 : 0,
    behind: behindMatch ? Number.parseInt(behindMatch[1] ?? '0', PARSE_INT_ARG_2) || 0 : 0,
  }
}

function parseBranchRefLine(line: string): GitBranchInfo {
  const [fullName = '', shortName = '', upstream = '', headMark = '', track = ''] = line.split('\t')
  const { ahead, behind } = parseTrackCounts(track)

  return {
    fullName,
    name: shortName,
    isRemote: fullName.startsWith('refs/remotes/'),
    isCurrent: headMark.trim() === '*',
    upstream: upstream || null,
    ahead,
    behind,
  }
}

function sortBranchRefs(left: GitBranchInfo, right: GitBranchInfo) {
  if (left.isRemote !== right.isRemote) {
    return left.isRemote ? 1 : -1
  }
  return left.name.localeCompare(right.name)
}

export async function listGitBranches(projectPath: string): Promise<GitBranchListResult> {
  if (!(await isGitRepository(projectPath))) {
    throw new Error('Selected folder is not a Git repository.')
  }

  const currentResult = await runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const currentBranchRaw = currentResult.code === 0 ? currentResult.stdout.trim() : ''
  const currentBranch = currentBranchRaw && currentBranchRaw !== 'HEAD' ? currentBranchRaw : null
  const refsResult = await runGit(projectPath, [
    'for-each-ref',
    '--format=%(refname)%09%(refname:short)%09%(upstream:short)%09%(HEAD)%09%(upstream:track)',
    'refs/heads',
    'refs/remotes',
  ])
  if (refsResult.code !== 0) {
    throw new Error(refsResult.stderr.trim() || 'Failed to load Git branches.')
  }

  return {
    currentBranch,
    branches: refsResult.stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map(parseBranchRefLine)
      .filter((entry) => !entry.name.endsWith('/HEAD'))
      .sort(sortBranchRefs),
  }
}
