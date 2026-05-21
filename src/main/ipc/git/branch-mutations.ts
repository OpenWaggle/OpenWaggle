import type {
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchDeletePayload,
  GitBranchMutationResult,
  GitBranchRenamePayload,
  GitBranchSetUpstreamPayload,
} from '@shared/types/git'
import { branchFailure, mapBranchFailure } from './branch-failures'
import { isGitRepository, runGit } from './shared'

function gitOutput(result: { readonly stderr: string; readonly stdout: string }) {
  return `${result.stderr}\n${result.stdout}`
}

function branchSuccess(message: string): GitBranchMutationResult {
  return { ok: true, message }
}

async function ensureBranchRepository(
  projectPath: string,
): Promise<GitBranchMutationResult | null> {
  if (await isGitRepository(projectPath)) {
    return null
  }
  return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
}

function remoteTrackingLocalName(remoteName: string) {
  return remoteName.split('/').slice(1).join('/')
}

async function checkoutExistingLocalTrackingBranch(
  projectPath: string,
  remoteName: string,
  localName: string,
): Promise<GitBranchMutationResult> {
  const upstreamResult = await runGit(projectPath, [
    'for-each-ref',
    '--format=%(upstream:short)',
    `refs/heads/${localName}`,
  ])
  const upstream = upstreamResult.code === 0 ? upstreamResult.stdout.trim() : ''
  if (upstream !== remoteName) {
    return branchFailure(
      'branch-exists',
      `Local branch "${localName}" already exists and is not tracking "${remoteName}".`,
    )
  }

  const checkoutLocalResult = await runGit(projectPath, ['checkout', localName])
  if (checkoutLocalResult.code !== 0) {
    return mapBranchFailure(gitOutput(checkoutLocalResult))
  }
  return { ok: true, message: `Switched to ${localName}.` }
}

async function checkoutRemoteBranch(projectPath: string, remoteName: string) {
  const localName = remoteTrackingLocalName(remoteName)
  if (localName) {
    const localExistsResult = await runGit(projectPath, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${localName}`,
    ])
    if (localExistsResult.code === 0) {
      return checkoutExistingLocalTrackingBranch(projectPath, remoteName, localName)
    }
  }

  const trackResult = await runGit(projectPath, ['checkout', '--track', remoteName])
  if (trackResult.code !== 0) {
    return mapBranchFailure(gitOutput(trackResult))
  }
  return branchSuccess(`Switched to tracking branch ${remoteName}.`)
}

export async function checkoutGitBranch(
  projectPath: string,
  payload: GitBranchCheckoutPayload,
): Promise<GitBranchMutationResult> {
  const name = payload.name.trim()
  if (!name) return branchFailure('invalid-name', 'Branch name is required.')

  const repoFailure = await ensureBranchRepository(projectPath)
  if (repoFailure) return repoFailure

  const remoteRefResult = await runGit(projectPath, [
    'show-ref',
    '--verify',
    '--quiet',
    `refs/remotes/${name}`,
  ])
  if (remoteRefResult.code === 0) {
    return checkoutRemoteBranch(projectPath, name)
  }

  const result = await runGit(projectPath, ['checkout', name])
  if (result.code !== 0) return mapBranchFailure(gitOutput(result))
  return branchSuccess(`Switched to ${name}.`)
}

async function validateNewBranchName(projectPath: string, name: string) {
  const validateResult = await runGit(projectPath, ['check-ref-format', '--branch', name])
  if (validateResult.code !== 0) return branchFailure('invalid-name', 'Branch name is invalid.')

  const existingResult = await runGit(projectPath, [
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${name}`,
  ])
  if (existingResult.code === 0)
    return branchFailure('branch-exists', 'A branch with this name already exists.')
  return null
}

async function createBranchRef(projectPath: string, payload: GitBranchCreatePayload, name: string) {
  const createArgs = ['branch', name]
  if (payload.startPoint?.trim()) createArgs.push(payload.startPoint.trim())

  const createResult = await runGit(projectPath, createArgs)
  if (createResult.code !== 0) return mapBranchFailure(gitOutput(createResult))
  return null
}

async function checkoutCreatedBranch(
  projectPath: string,
  payload: GitBranchCreatePayload,
  name: string,
) {
  if (!payload.checkout) return null

  const checkoutResult = await runGit(projectPath, ['checkout', name])
  if (checkoutResult.code !== 0) return mapBranchFailure(gitOutput(checkoutResult))
  return null
}

export async function createGitBranch(
  projectPath: string,
  payload: GitBranchCreatePayload,
): Promise<GitBranchMutationResult> {
  const name = payload.name.trim()
  if (!name) return branchFailure('invalid-name', 'Branch name is required.')

  const repoFailure = await ensureBranchRepository(projectPath)
  if (repoFailure) return repoFailure

  const nameFailure = await validateNewBranchName(projectPath, name)
  if (nameFailure) return nameFailure

  const createFailure = await createBranchRef(projectPath, payload, name)
  if (createFailure) return createFailure

  const checkoutFailure = await checkoutCreatedBranch(projectPath, payload, name)
  if (checkoutFailure) return checkoutFailure

  return branchSuccess(payload.checkout ? `Created and checked out ${name}.` : `Created ${name}.`)
}

export async function renameGitBranch(
  projectPath: string,
  payload: GitBranchRenamePayload,
): Promise<GitBranchMutationResult> {
  const from = payload.from.trim()
  const to = payload.to.trim()
  if (!from || !to)
    return branchFailure('invalid-name', 'Both source and target branch names are required.')

  const repoFailure = await ensureBranchRepository(projectPath)
  if (repoFailure) return repoFailure

  const result = await runGit(projectPath, ['branch', '-m', from, to])
  if (result.code !== 0) return mapBranchFailure(gitOutput(result))
  return branchSuccess(`Renamed ${from} to ${to}.`)
}

export async function deleteGitBranch(
  projectPath: string,
  payload: GitBranchDeletePayload,
): Promise<GitBranchMutationResult> {
  const name = payload.name.trim()
  if (!name) return branchFailure('invalid-name', 'Branch name is required.')

  const repoFailure = await ensureBranchRepository(projectPath)
  if (repoFailure) return repoFailure

  const result = await runGit(projectPath, ['branch', payload.force ? '-D' : '-d', name])
  if (result.code !== 0) return mapBranchFailure(gitOutput(result))
  return branchSuccess(`Deleted ${name}.`)
}

export async function setGitBranchUpstream(
  projectPath: string,
  payload: GitBranchSetUpstreamPayload,
): Promise<GitBranchMutationResult> {
  const name = payload.name.trim()
  const upstream = payload.upstream.trim()
  if (!name || !upstream) return branchFailure('invalid-name', 'Branch and upstream are required.')

  const repoFailure = await ensureBranchRepository(projectPath)
  if (repoFailure) return repoFailure

  const result = await runGit(projectPath, ['branch', '--set-upstream-to', upstream, name])
  if (result.code !== 0) return mapBranchFailure(gitOutput(result))
  return branchSuccess(`Set upstream for ${name} to ${upstream}.`)
}
