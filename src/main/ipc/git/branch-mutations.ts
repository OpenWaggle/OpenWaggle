import type {
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchMutationResult,
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
