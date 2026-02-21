import type {
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchDeletePayload,
  GitBranchInfo,
  GitBranchListResult,
  GitBranchMutationFailure,
  GitBranchMutationResult,
  GitBranchRenamePayload,
  GitBranchSetUpstreamPayload,
} from '@shared/types/git'
import { z } from 'zod'
import { safeHandle } from '../typed-ipc'
import { isGitRepository, projectPathSchema, runGit } from './shared'

function parseTrackCounts(track: string): { ahead: number; behind: number } {
  const aheadMatch = /ahead (\d+)/.exec(track)
  const behindMatch = /behind (\d+)/.exec(track)
  return {
    ahead: aheadMatch ? Number.parseInt(aheadMatch[1] ?? '0', 10) || 0 : 0,
    behind: behindMatch ? Number.parseInt(behindMatch[1] ?? '0', 10) || 0 : 0,
  }
}

function branchFailure(
  code: GitBranchMutationFailure['code'],
  message: string,
): GitBranchMutationFailure {
  return { ok: false, code, message }
}

function mapBranchFailure(stderr: string): GitBranchMutationFailure {
  const message = stderr.trim()
  const lower = message.toLowerCase()

  if (lower.includes('not a git repository')) {
    return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }
  if (
    lower.includes('did not match any file') ||
    lower.includes('unknown revision') ||
    lower.includes("isn't a commit") ||
    lower.includes('not found')
  ) {
    return branchFailure('branch-not-found', 'The requested branch could not be found.')
  }
  if (lower.includes('already exists')) {
    return branchFailure('branch-exists', 'A branch with this name already exists.')
  }
  if (
    lower.includes('local changes') ||
    lower.includes('would be overwritten by checkout') ||
    lower.includes('please commit your changes or stash')
  ) {
    return branchFailure(
      'dirty-worktree',
      'Commit or stash local changes before switching branches.',
    )
  }
  if (
    lower.includes('is not a valid branch name') ||
    lower.includes('not a valid object name') ||
    lower.includes('invalid refspec') ||
    lower.includes('invalid branch name')
  ) {
    return branchFailure('invalid-name', 'Branch name is invalid.')
  }
  if (
    lower.includes('cannot delete branch') &&
    (lower.includes('checked out') || lower.includes('currently checked out'))
  ) {
    return branchFailure(
      'unknown',
      'Cannot delete the currently checked out branch. Switch branches and try again.',
    )
  }
  if (lower.includes('upstream branch') && lower.includes('does not exist')) {
    return branchFailure('upstream-not-found', 'The selected upstream branch does not exist.')
  }

  return branchFailure('unknown', message || 'Git branch operation failed.')
}

async function listGitBranches(projectPath: string): Promise<GitBranchListResult> {
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

  const branches: GitBranchInfo[] = refsResult.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [fullName = '', shortName = '', upstream = '', headMark = '', track = ''] =
        line.split('\t')
      const { ahead, behind } = parseTrackCounts(track)

      return {
        fullName,
        name: shortName,
        isRemote: fullName.startsWith('refs/remotes/'),
        isCurrent: headMark.trim() === '*',
        upstream: upstream || null,
        ahead,
        behind,
      } satisfies GitBranchInfo
    })
    .filter((entry) => !entry.name.endsWith('/HEAD'))
    .sort((a, b) => {
      if (a.isRemote !== b.isRemote) {
        return a.isRemote ? 1 : -1
      }
      return a.name.localeCompare(b.name)
    })

  return {
    currentBranch,
    branches,
  }
}

async function checkoutGitBranch(
  projectPath: string,
  payload: GitBranchCheckoutPayload,
): Promise<GitBranchMutationResult> {
  const name = payload.name.trim()
  if (!name) {
    return branchFailure('invalid-name', 'Branch name is required.')
  }
  if (!(await isGitRepository(projectPath))) {
    return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  // If selecting a remote ref (e.g. origin/feature), prefer checking out
  // the corresponding local tracking branch instead of detached HEAD.
  const remoteRefResult = await runGit(projectPath, [
    'show-ref',
    '--verify',
    '--quiet',
    `refs/remotes/${name}`,
  ])
  if (remoteRefResult.code === 0) {
    const localName = name.split('/').slice(1).join('/')
    if (localName) {
      const localExistsResult = await runGit(projectPath, [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/heads/${localName}`,
      ])
      if (localExistsResult.code === 0) {
        const upstreamResult = await runGit(projectPath, [
          'for-each-ref',
          '--format=%(upstream:short)',
          `refs/heads/${localName}`,
        ])
        const upstream = upstreamResult.code === 0 ? upstreamResult.stdout.trim() : ''
        if (upstream === name) {
          const checkoutLocalResult = await runGit(projectPath, ['checkout', localName])
          if (checkoutLocalResult.code !== 0) {
            return mapBranchFailure(`${checkoutLocalResult.stderr}\n${checkoutLocalResult.stdout}`)
          }
          return { ok: true, message: `Switched to ${localName}.` }
        }
        return branchFailure(
          'branch-exists',
          `Local branch "${localName}" already exists and is not tracking "${name}".`,
        )
      }
    }

    const trackResult = await runGit(projectPath, ['checkout', '--track', name])
    if (trackResult.code !== 0) {
      return mapBranchFailure(`${trackResult.stderr}\n${trackResult.stdout}`)
    }
    return { ok: true, message: `Switched to tracking branch ${name}.` }
  }

  const result = await runGit(projectPath, ['checkout', name])
  if (result.code !== 0) {
    return mapBranchFailure(`${result.stderr}\n${result.stdout}`)
  }

  return { ok: true, message: `Switched to ${name}.` }
}

async function createGitBranch(
  projectPath: string,
  payload: GitBranchCreatePayload,
): Promise<GitBranchMutationResult> {
  const name = payload.name.trim()
  if (!name) {
    return branchFailure('invalid-name', 'Branch name is required.')
  }
  if (!(await isGitRepository(projectPath))) {
    return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const validateResult = await runGit(projectPath, ['check-ref-format', '--branch', name])
  if (validateResult.code !== 0) {
    return branchFailure('invalid-name', 'Branch name is invalid.')
  }

  const existingResult = await runGit(projectPath, [
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${name}`,
  ])
  if (existingResult.code === 0) {
    return branchFailure('branch-exists', 'A branch with this name already exists.')
  }

  const createArgs = ['branch', name]
  if (payload.startPoint?.trim()) {
    createArgs.push(payload.startPoint.trim())
  }
  const createResult = await runGit(projectPath, createArgs)
  if (createResult.code !== 0) {
    return mapBranchFailure(`${createResult.stderr}\n${createResult.stdout}`)
  }

  if (payload.checkout) {
    const checkoutResult = await runGit(projectPath, ['checkout', name])
    if (checkoutResult.code !== 0) {
      return mapBranchFailure(`${checkoutResult.stderr}\n${checkoutResult.stdout}`)
    }
  }

  return {
    ok: true,
    message: payload.checkout ? `Created and checked out ${name}.` : `Created ${name}.`,
  }
}

async function renameGitBranch(
  projectPath: string,
  payload: GitBranchRenamePayload,
): Promise<GitBranchMutationResult> {
  const from = payload.from.trim()
  const to = payload.to.trim()
  if (!from || !to) {
    return branchFailure('invalid-name', 'Both source and target branch names are required.')
  }
  if (!(await isGitRepository(projectPath))) {
    return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const result = await runGit(projectPath, ['branch', '-m', from, to])
  if (result.code !== 0) {
    return mapBranchFailure(`${result.stderr}\n${result.stdout}`)
  }

  return { ok: true, message: `Renamed ${from} to ${to}.` }
}

async function deleteGitBranch(
  projectPath: string,
  payload: GitBranchDeletePayload,
): Promise<GitBranchMutationResult> {
  const name = payload.name.trim()
  if (!name) {
    return branchFailure('invalid-name', 'Branch name is required.')
  }
  if (!(await isGitRepository(projectPath))) {
    return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const result = await runGit(projectPath, ['branch', payload.force ? '-D' : '-d', name])
  if (result.code !== 0) {
    return mapBranchFailure(`${result.stderr}\n${result.stdout}`)
  }

  return { ok: true, message: `Deleted ${name}.` }
}

async function setGitBranchUpstream(
  projectPath: string,
  payload: GitBranchSetUpstreamPayload,
): Promise<GitBranchMutationResult> {
  const name = payload.name.trim()
  const upstream = payload.upstream.trim()
  if (!name || !upstream) {
    return branchFailure('invalid-name', 'Branch and upstream are required.')
  }
  if (!(await isGitRepository(projectPath))) {
    return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const result = await runGit(projectPath, ['branch', '--set-upstream-to', upstream, name])
  if (result.code !== 0) {
    return mapBranchFailure(`${result.stderr}\n${result.stdout}`)
  }

  return { ok: true, message: `Set upstream for ${name} to ${upstream}.` }
}

const branchCheckoutPayloadSchema = z.object({
  name: z.string(),
})

const branchCreatePayloadSchema = z.object({
  name: z.string(),
  startPoint: z.string().optional(),
  checkout: z.boolean().optional(),
})

const branchRenamePayloadSchema = z.object({
  from: z.string(),
  to: z.string(),
})

const branchDeletePayloadSchema = z.object({
  name: z.string(),
  force: z.boolean().optional(),
})

const branchSetUpstreamPayloadSchema = z.object({
  name: z.string(),
  upstream: z.string(),
})

export function registerGitBranchHandlers(): void {
  safeHandle('git:branches:list', async (_event, rawPath: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    return listGitBranches(projectPath)
  })

  safeHandle('git:branches:checkout', async (_event, rawPath: unknown, rawPayload: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    const payload = branchCheckoutPayloadSchema.parse(rawPayload)
    return checkoutGitBranch(projectPath, payload)
  })

  safeHandle('git:branches:create', async (_event, rawPath: unknown, rawPayload: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    const payload = branchCreatePayloadSchema.parse(rawPayload)
    return createGitBranch(projectPath, payload)
  })

  safeHandle('git:branches:rename', async (_event, rawPath: unknown, rawPayload: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    const payload = branchRenamePayloadSchema.parse(rawPayload)
    return renameGitBranch(projectPath, payload)
  })

  safeHandle('git:branches:delete', async (_event, rawPath: unknown, rawPayload: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    const payload = branchDeletePayloadSchema.parse(rawPayload)
    return deleteGitBranch(projectPath, payload)
  })

  safeHandle('git:branches:set-upstream', async (_event, rawPath: unknown, rawPayload: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    const payload = branchSetUpstreamPayloadSchema.parse(rawPayload)
    return setGitBranchUpstream(projectPath, payload)
  })
}
