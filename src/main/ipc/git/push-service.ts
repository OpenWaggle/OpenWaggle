import { networkGitOptions } from '../../adapters/git/run-git'
import { resolvePrimaryRemote } from './primary-remote'
import { isGitRepository, runGit } from './shared'

/**
 * Long enough to transfer objects over a slow link, short enough that the UI is never stuck for good.
 *
 * A push, pull or fetch reaches the network from an interactive path, so it must be bounded and must never
 * prompt: without this it blocks for git's own connect timeout, or forever on a credential prompt.
 */
const PUSH_TIMEOUT_MS = 120_000

export interface GitPushResult {
  readonly ok: boolean
  readonly code: 'ok' | 'not-git-repo' | 'no-upstream' | 'push-failed'
  readonly message: string
}

export interface GitPullResult {
  readonly ok: boolean
  readonly code: 'ok' | 'not-git-repo' | 'pull-failed'
  readonly message: string
}

async function currentBranch(projectPath: string): Promise<string | null> {
  const result = await runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (result.code !== 0) return null
  return result.stdout.trim() || null
}

/** The upstream as `<remote>/<branch>`, or null when the branch tracks nothing. */
async function upstreamRef(
  projectPath: string,
): Promise<{ remote: string; branch: string } | null> {
  const result = await runGit(projectPath, ['rev-parse', '--abbrev-ref', '@{upstream}'])
  if (result.code !== 0) return null
  const value = result.stdout.trim()
  const separator = value.indexOf('/')
  if (separator <= 0 || separator === value.length - 1) return null
  return { remote: value.slice(0, separator), branch: value.slice(separator + 1) }
}

/** Push the current branch, setting upstream to the selected remote on first push. */
export async function pushCurrentBranch(
  projectPath: string,
  firstPushRemote?: string,
): Promise<GitPushResult> {
  if (!(await isGitRepository(projectPath))) {
    return { ok: false, code: 'not-git-repo', message: 'Selected folder is not a Git repository.' }
  }

  const upstream = await upstreamRef(projectPath)
  if (upstream) {
    /*
     * The destination is named, not left to configuration.
     *
     * A bare `git push` resolves where to write from `push.default`, so the same command lands somewhere
     * different depending on a setting this app never sees. Naming the upstream explicitly makes the destination
     * the one the confirmation gate was shown - and it is still the user's own mapping, so a branch deliberately
     * tracking a differently-named remote branch keeps working.
     */
    const result = await runGit(
      projectPath,
      ['push', upstream.remote, `HEAD:refs/heads/${upstream.branch}`],
      networkGitOptions(PUSH_TIMEOUT_MS),
    )
    return result.code === 0
      ? { ok: true, code: 'ok', message: `Pushed to ${upstream.remote}/${upstream.branch}.` }
      : { ok: false, code: 'push-failed', message: result.stderr.trim() || 'Failed to push.' }
  }

  const branch = await currentBranch(projectPath)
  if (!branch) {
    return { ok: false, code: 'no-upstream', message: 'Cannot push a detached HEAD.' }
  }
  const destinationRemote =
    firstPushRemote ?? (await resolvePrimaryRemote(projectPath))?.name ?? 'origin'
  const result = await runGit(
    projectPath,
    ['push', '-u', destinationRemote, branch],
    networkGitOptions(PUSH_TIMEOUT_MS),
  )
  return result.code === 0
    ? {
        ok: true,
        code: 'ok',
        message: `Pushed and set upstream to ${destinationRemote}/${branch}.`,
      }
    : { ok: false, code: 'push-failed', message: result.stderr.trim() || 'Failed to push.' }
}

/** Pull the current branch. */
export async function pullCurrentBranch(projectPath: string): Promise<GitPullResult> {
  if (!(await isGitRepository(projectPath))) {
    return { ok: false, code: 'not-git-repo', message: 'Selected folder is not a Git repository.' }
  }
  const result = await runGit(
    projectPath,
    ['pull', '--ff-only'],
    networkGitOptions(PUSH_TIMEOUT_MS),
  )
  return result.code === 0
    ? { ok: true, code: 'ok', message: 'Pulled latest changes.' }
    : { ok: false, code: 'pull-failed', message: result.stderr.trim() || 'Failed to pull.' }
}
