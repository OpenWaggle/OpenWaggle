import type {
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchMutationResult,
  GitBranchValidationResult,
} from '@shared/types/git'
import { branchFailure, mapBranchFailure } from './branch-failures'
import { listConfiguredRemoteNames, resolveRemoteBranchName } from './remote-branch-name'
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

async function createRemoteTrackingBranch(
  projectPath: string,
  remoteRef: string,
  remoteName: string,
  localName: string,
): Promise<GitBranchMutationResult> {
  const createResult = await runGit(projectPath, ['branch', '--no-track', localName, remoteRef])
  if (createResult.code !== 0) return mapBranchFailure(gitOutput(createResult))

  const remoteConfigResult = await runGit(projectPath, [
    'config',
    `branch.${localName}.remote`,
    remoteName,
  ])
  if (remoteConfigResult.code !== 0) return mapBranchFailure(gitOutput(remoteConfigResult))

  const mergeConfigResult = await runGit(projectPath, [
    'config',
    `branch.${localName}.merge`,
    `refs/heads/${localName}`,
  ])
  if (mergeConfigResult.code !== 0) return mapBranchFailure(gitOutput(mergeConfigResult))

  const checkoutResult = await runGit(projectPath, ['checkout', localName])
  if (checkoutResult.code !== 0) return mapBranchFailure(gitOutput(checkoutResult))
  return branchSuccess(`Switched to tracking branch ${remoteRef}.`)
}

async function checkoutRemoteBranch(projectPath: string, remoteRef: string) {
  const configuredRemotes = await listConfiguredRemoteNames(projectPath)
  const resolved = resolveRemoteBranchName(remoteRef, configuredRemotes)
  if (resolved?.localName) {
    const localExistsResult = await runGit(projectPath, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${resolved.localName}`,
    ])
    if (localExistsResult.code === 0) {
      return checkoutExistingLocalTrackingBranch(projectPath, remoteRef, resolved.localName)
    }
    return createRemoteTrackingBranch(
      projectPath,
      remoteRef,
      resolved.remoteName,
      resolved.localName,
    )
  }

  const trackResult = await runGit(projectPath, ['checkout', '--track', remoteRef])
  if (trackResult.code !== 0) {
    return mapBranchFailure(gitOutput(trackResult))
  }
  return branchSuccess(`Switched to tracking branch ${remoteRef}.`)
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

function branchRefName(ref: string, remoteNames: readonly string[]) {
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length)
  const remoteRefPrefix = 'refs/remotes/'
  if (!ref.startsWith(remoteRefPrefix)) return ref
  const remoteRefName = ref.slice(remoteRefPrefix.length)
  return resolveRemoteBranchName(remoteRefName, remoteNames)?.localName ?? remoteRefName
}

function refsConflict(first: string, second: string) {
  return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`)
}

async function validateNewBranchName(
  projectPath: string,
  name: string,
): Promise<GitBranchValidationResult> {
  const validateResult = await runGit(projectPath, ['check-ref-format', '--branch', name])
  if (validateResult.code !== 0) {
    return { ok: false, code: 'invalid-name', message: 'Branch name is invalid.' }
  }

  const refsResult = await runGit(projectPath, [
    'for-each-ref',
    '--format=%(refname)',
    'refs/heads',
    'refs/remotes',
  ])
  if (refsResult.code === 0) {
    const remoteNames = await listConfiguredRemoteNames(projectPath)
    const conflict = refsResult.stdout
      .split('\n')
      .map((ref) => ref.trim())
      .filter(Boolean)
      .map((ref) => branchRefName(ref, remoteNames))
      .find((existing) => refsConflict(existing, name))
    if (conflict) {
      return {
        ok: false,
        code: 'branch-exists',
        message: `Branch "${name}" conflicts with existing ref "${conflict}".`,
      }
    }
  }
  return { ok: true }
}

export async function validateGitBranchName(
  projectPath: string,
  rawName: string,
): Promise<GitBranchValidationResult> {
  const name = rawName.trim()
  if (!name) return { ok: false, code: 'required', message: 'Branch name is required.' }
  if (!(await isGitRepository(projectPath))) {
    return {
      ok: false,
      code: 'not-git-repo',
      message: 'Selected folder is not a Git repository.',
    }
  }
  return validateNewBranchName(projectPath, name)
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
  if (!nameFailure.ok) {
    const code = nameFailure.code === 'branch-exists' ? 'branch-exists' : 'invalid-name'
    return branchFailure(code, nameFailure.message)
  }

  const createFailure = await createBranchRef(projectPath, payload, name)
  if (createFailure) return createFailure

  const checkoutFailure = await checkoutCreatedBranch(projectPath, payload, name)
  if (checkoutFailure) return checkoutFailure

  return branchSuccess(payload.checkout ? `Created and checked out ${name}.` : `Created ${name}.`)
}
