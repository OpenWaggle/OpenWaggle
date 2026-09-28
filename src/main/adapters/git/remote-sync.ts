import { runWithGitNetworkLock } from '../../services/git/mutation-lock'
import { isGitRepository, networkGitOptions, runGit } from './run-git'

/**
 * A remote sync reaches the network from an interactive path, so it must be bounded and must never
 * prompt: without this it blocks for git's own connect timeout, or forever on a credential prompt.
 */
const REMOTE_SYNC_TIMEOUT_MS = 120_000

export interface RemoteSyncResult {
  readonly ok: boolean
  readonly message: string
}

/**
 * The checked-out branch and the upstream it tracks, read locally without touching the network.
 * Null for a detached HEAD or a branch with no upstream, where a pull could only fail.
 */
export async function resolveTrackedBranch(
  projectPath: string,
): Promise<{ readonly branch: string; readonly upstream: string } | null> {
  const [branch, upstream] = await Promise.all([
    runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    runGit(projectPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
  ])
  const branchName = branch.code === 0 ? branch.stdout.trim() : ''
  const upstreamName = upstream.code === 0 ? upstream.stdout.trim() : ''
  return branchName && upstreamName ? { branch: branchName, upstream: upstreamName } : null
}

/** Pull the current branch, refusing anything but a fast-forward so local state is never rewritten. */
export async function pullCurrentBranchFastForward(
  projectPath: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<RemoteSyncResult> {
  if (!(await isGitRepository(projectPath))) {
    return { ok: false, message: 'Selected folder is not a Git repository.' }
  }
  const result = await runWithGitNetworkLock(projectPath, () =>
    runGit(projectPath, ['pull', '--ff-only'], {
      ...networkGitOptions(REMOTE_SYNC_TIMEOUT_MS),
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  )
  return result.code === 0
    ? { ok: true, message: 'Pulled latest changes.' }
    : { ok: false, message: result.stderr.trim() || 'Failed to pull.' }
}

/**
 * Best-effort refresh of `origin/<branch>`; returns whether the fetch succeeded.
 *
 * // ponytail: assumes the conventional `origin` remote; resolve the primary remote here if exotic remote names matter.
 */
export async function fetchRemoteBranch(
  projectPath: string,
  branch: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<boolean> {
  const result = await runWithGitNetworkLock(projectPath, () =>
    runGit(projectPath, ['fetch', '--quiet', 'origin', branch], {
      ...networkGitOptions(REMOTE_SYNC_TIMEOUT_MS),
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  )
  return result.code === 0
}

/**
 * Whether the local branch is an ancestor of (or equal to) its remote-tracking tip, so basing work
 * on `origin/<branch>` keeps every local commit while gaining the remote's latest work.
 */
export async function localBranchIsBehindRemote(
  projectPath: string,
  branch: string,
): Promise<boolean> {
  const result = await runGit(projectPath, [
    'merge-base',
    '--is-ancestor',
    branch,
    `origin/${branch}`,
  ])
  return result.code === 0
}

/**
 * Whether `<branch>` names a local branch, including slash-named ones (`feature/foo`). Used to
 * distinguish a chosen local branch from an already remote-qualified or namespaced ref.
 */
export async function isLocalBranch(projectPath: string, branch: string): Promise<boolean> {
  const result = await runGit(projectPath, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  ])
  return result.code === 0
}
