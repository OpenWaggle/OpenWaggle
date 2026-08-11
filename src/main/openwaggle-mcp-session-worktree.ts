import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import { getSafeChildEnv } from './env'
import type {
  HostedSessionWorktreeInput,
  HostedWorktreeResult,
} from './openwaggle-mcp-session-contract'
import { prepareHostedWorktreeDestination } from './openwaggle-mcp-session-worktree-destination'

const GIT_MAX_BUFFER_MEBIBYTES = 5
const GIT_MAX_BUFFER_BYTES = GIT_MAX_BUFFER_MEBIBYTES * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE
const WORKTREE_ID_LENGTH = 16
const REPOSITORY_ID_LENGTH = 8
const MAX_BASE_REF_LENGTH = 200

interface GitResult {
  readonly stdout: string
  readonly stderr: string
}

function runGit(projectPath: string, args: readonly string[]) {
  return new Promise<GitResult>((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd: projectPath,
        encoding: 'utf8',
        env: getSafeChildEnv(),
        maxBuffer: GIT_MAX_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message, { cause: error }))
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

async function pathExists(candidate: string) {
  try {
    await lstat(candidate)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function gitCommonDirectory(projectPath: string) {
  const result = await runGit(projectPath, ['rev-parse', '--git-common-dir'])
  return realpath(path.resolve(projectPath, result.stdout.trim()))
}

async function currentBranch(projectPath: string) {
  const result = await runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const branch = result.stdout.trim()
  if (!branch) throw new Error('The source repository has no current branch to use as a base.')
  return branch
}

async function localBranchCommit(projectPath: string, branch: string) {
  try {
    const result = await runGit(projectPath, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `refs/heads/${branch}^{commit}`,
    ])
    return result.stdout.trim() || null
  } catch {
    return null
  }
}

function validateBaseRef(baseRef: string) {
  if (!baseRef || baseRef.length > MAX_BASE_REF_LENGTH || baseRef.startsWith('-')) {
    throw new Error('The worktree base ref is empty, too long, or begins with an option prefix.')
  }
}

async function resolveBaseRef(input: HostedSessionWorktreeInput) {
  const requested = input.baseRef?.trim() || (await currentBranch(input.sourceProjectPath))
  validateBaseRef(requested)
  const resolved =
    input.startFromOrigin && !requested.includes('/') ? `origin/${requested}` : requested
  validateBaseRef(resolved)
  const commit = await runGit(input.sourceProjectPath, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${resolved}^{commit}`,
  ])
  return { baseRef: resolved, commit: commit.stdout.trim() }
}

function worktreeIdentity(sourceSessionId: string, commonDirectory: string, storageRoot: string) {
  const worktreeId = createHash('sha256')
    .update(sourceSessionId)
    .digest('hex')
    .slice(0, WORKTREE_ID_LENGTH)
  const repositoryId = createHash('sha256')
    .update(commonDirectory)
    .digest('hex')
    .slice(0, REPOSITORY_ID_LENGTH)
  return {
    branch: `ow/session-${worktreeId}`,
    projectPath: path.join(
      storageRoot,
      `${path.basename(commonDirectory)}-${repositoryId}`,
      worktreeId,
    ),
  }
}

async function inspectExistingWorktree(
  sourceCommonDirectory: string,
  projectPath: string,
  expectedBranch: string,
) {
  const destination = await lstat(projectPath)
  if (destination.isSymbolicLink() || (await realpath(projectPath)) !== path.resolve(projectPath)) {
    throw new Error(
      `Refusing to reuse symbolic-link worktree destination ${JSON.stringify(projectPath)}.`,
    )
  }
  const existingCommonDirectory = await gitCommonDirectory(projectPath).catch(() => null)
  if (!existingCommonDirectory || existingCommonDirectory !== sourceCommonDirectory) {
    throw new Error(
      `Refusing to reuse ${JSON.stringify(projectPath)} because it is not a worktree of the granted source repository.`,
    )
  }
  const branch = (
    await runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  ).stdout.trim()
  if (branch !== expectedBranch) {
    throw new Error(
      `Refusing to reuse ${JSON.stringify(projectPath)} because it is on ${JSON.stringify(branch)}, not ${JSON.stringify(expectedBranch)}.`,
    )
  }
}

export async function assertHostedSessionWorktreeProvenance(input: {
  readonly sourceProjectPath: string
  readonly sourceSessionId: string
  readonly projectPath: string
  readonly branch: string
}) {
  const sourceCommonDirectory = await gitCommonDirectory(input.sourceProjectPath)
  const identity = worktreeIdentity(
    input.sourceSessionId,
    sourceCommonDirectory,
    path.join(homedir(), '.openwaggle', 'worktrees'),
  )
  if (identity.projectPath !== input.projectPath || identity.branch !== input.branch) {
    throw new Error('The hosted worktree no longer matches its deterministic provenance.')
  }
  await inspectExistingWorktree(sourceCommonDirectory, input.projectPath, input.branch)
}

export async function materializeHostedSessionWorktree(
  input: HostedSessionWorktreeInput,
  storageRoot = path.join(homedir(), '.openwaggle', 'worktrees'),
): Promise<HostedWorktreeResult> {
  const [sourceCommonDirectory, { baseRef, commit: baseCommit }] = await Promise.all([
    gitCommonDirectory(input.sourceProjectPath),
    resolveBaseRef(input),
  ])
  const identity = worktreeIdentity(input.sourceSessionId, sourceCommonDirectory, storageRoot)
  if (await pathExists(identity.projectPath)) {
    await inspectExistingWorktree(sourceCommonDirectory, identity.projectPath, identity.branch)
    return { ...identity, sourceProjectPath: input.sourceProjectPath, baseRef, created: false }
  }

  await prepareHostedWorktreeDestination(storageRoot, path.dirname(identity.projectPath))
  const residualBranchCommit = await localBranchCommit(input.sourceProjectPath, identity.branch)
  if (residualBranchCommit && residualBranchCommit !== baseCommit) {
    throw new Error(
      `Refusing to reuse deterministic branch ${JSON.stringify(identity.branch)} because it points at a different commit. Inspect or remove the residual branch, then retry.`,
    )
  }
  try {
    await runGit(
      input.sourceProjectPath,
      residualBranchCommit
        ? ['worktree', 'add', '--', identity.projectPath, identity.branch]
        : ['worktree', 'add', '-b', identity.branch, '--', identity.projectPath, baseRef],
    )
    await inspectExistingWorktree(sourceCommonDirectory, identity.projectPath, identity.branch)
    return { ...identity, sourceProjectPath: input.sourceProjectPath, baseRef, created: true }
  } catch (error) {
    const partial = {
      ...identity,
      sourceProjectPath: input.sourceProjectPath,
      baseRef,
      created: true,
    }
    let cleanupError: unknown
    try {
      const destinationExists = await pathExists(identity.projectPath)
      if (destinationExists) {
        await removeHostedSessionWorktreeState(partial, residualBranchCommit === null)
      }
      if (!destinationExists && residualBranchCommit === null) {
        await removeCreatedBranchResidual(input.sourceProjectPath, identity.branch, baseCommit)
      }
    } catch (cleanupFailure) {
      cleanupError = cleanupFailure
    }
    if (cleanupError) {
      throw new Error(
        `Creating the hosted Git worktree failed: ${describeError(error)}. Cleanup also failed; inspect ${identity.projectPath} and branch ${identity.branch}: ${describeError(cleanupError)}.`,
        { cause: error },
      )
    }
    throw error
  }
}

async function removeCreatedBranchResidual(
  sourceProjectPath: string,
  branch: string,
  expectedCommit: string,
) {
  const commit = await localBranchCommit(sourceProjectPath, branch)
  if (!commit) return
  if (commit !== expectedCommit) {
    throw new Error(
      `Refusing to remove residual branch ${JSON.stringify(branch)} because its commit changed during worktree creation.`,
    )
  }
  await runGit(sourceProjectPath, ['branch', '-D', '--', branch])
}

export async function removeHostedSessionWorktree(worktree: HostedWorktreeResult) {
  return removeHostedSessionWorktreeState(worktree, true)
}

async function removeHostedSessionWorktreeState(
  worktree: HostedWorktreeResult,
  removeBranch: boolean,
) {
  if (!worktree.created || !(await pathExists(worktree.projectPath))) return
  const [commonDirectory, sourceCommonDirectory] = await Promise.all([
    gitCommonDirectory(worktree.projectPath),
    gitCommonDirectory(worktree.sourceProjectPath),
  ])
  if (commonDirectory !== sourceCommonDirectory) {
    throw new Error(
      `Refusing to clean up ${JSON.stringify(worktree.projectPath)} because its Git common directory changed.`,
    )
  }
  const branch = (
    await runGit(worktree.projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  ).stdout.trim()
  if (branch !== worktree.branch) {
    throw new Error(
      `Refusing to clean up ${JSON.stringify(worktree.projectPath)} because its branch changed.`,
    )
  }
  await runGit(worktree.sourceProjectPath, ['worktree', 'remove', '--', worktree.projectPath])
  if (removeBranch) {
    await runGit(worktree.sourceProjectPath, ['branch', '-d', '--', worktree.branch])
  }
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
