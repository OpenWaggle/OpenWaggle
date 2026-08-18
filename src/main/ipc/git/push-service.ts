import { isGitRepository, runGit } from './shared'

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

async function hasUpstream(projectPath: string): Promise<boolean> {
  const result = await runGit(projectPath, ['rev-parse', '--abbrev-ref', '@{upstream}'])
  return result.code === 0 && result.stdout.trim().length > 0
}

/** Push the current branch, setting upstream to origin/<branch> on first push. */
export async function pushCurrentBranch(projectPath: string): Promise<GitPushResult> {
  if (!(await isGitRepository(projectPath))) {
    return { ok: false, code: 'not-git-repo', message: 'Selected folder is not a Git repository.' }
  }

  if (await hasUpstream(projectPath)) {
    const result = await runGit(projectPath, ['push'])
    return result.code === 0
      ? { ok: true, code: 'ok', message: 'Pushed to upstream.' }
      : { ok: false, code: 'push-failed', message: result.stderr.trim() || 'Failed to push.' }
  }

  const branch = await currentBranch(projectPath)
  if (!branch) {
    return { ok: false, code: 'no-upstream', message: 'Cannot push a detached HEAD.' }
  }
  // ponytail: hardcoded 'origin'; add remote selection only if multi-remote push is requested.
  const result = await runGit(projectPath, ['push', '-u', 'origin', branch])
  return result.code === 0
    ? { ok: true, code: 'ok', message: `Pushed and set upstream to origin/${branch}.` }
    : { ok: false, code: 'push-failed', message: result.stderr.trim() || 'Failed to push.' }
}

/** Pull the current branch. */
export async function pullCurrentBranch(projectPath: string): Promise<GitPullResult> {
  if (!(await isGitRepository(projectPath))) {
    return { ok: false, code: 'not-git-repo', message: 'Selected folder is not a Git repository.' }
  }
  const result = await runGit(projectPath, ['pull', '--ff-only'])
  return result.code === 0
    ? { ok: true, code: 'ok', message: 'Pulled latest changes.' }
    : { ok: false, code: 'pull-failed', message: result.stderr.trim() || 'Failed to pull.' }
}
