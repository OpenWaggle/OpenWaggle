import { runGit } from './shared'

/**
 * The repository's default branch, without a remote prefix.
 *
 * Prefers what the remote itself advertises (`refs/remotes/origin/HEAD`) and falls back to
 * the locally configured `init.defaultBranch`. Returns null when neither is known, which is
 * normal for a fresh repository with no remote.
 *
 * Shared by VCS status (ahead/behind against the default branch) and the diff panel's
 * Automatic base ref, so the two cannot disagree about which branch "default" means.
 */
export async function resolveDefaultRef(projectPath: string): Promise<string | null> {
  const headResult = await runGit(projectPath, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ])
  if (headResult.code === 0 && headResult.stdout.trim()) {
    return headResult.stdout.trim().replace(/^origin\//, '')
  }
  const configResult = await runGit(projectPath, ['config', '--get', 'init.defaultBranch'])
  if (configResult.code === 0 && configResult.stdout.trim()) return configResult.stdout.trim()
  return null
}

/**
 * A revision for the default branch that actually exists in this repository.
 *
 * Prefers the remote-tracking ref, because that is what a reviewer means by "how does my
 * work differ from the default branch". Falls back to the local branch when there is no
 * remote copy, and to null when the default branch is not present at all - a repository
 * whose `init.defaultBranch` names a branch that was never created.
 */
export async function resolveDefaultBranchRevision(projectPath: string): Promise<string | null> {
  const defaultRef = await resolveDefaultRef(projectPath)
  if (defaultRef === null) return null

  for (const candidate of [`origin/${defaultRef}`, defaultRef]) {
    const verify = await runGit(projectPath, ['rev-parse', '--verify', `${candidate}^{commit}`])
    if (verify.code === 0) return candidate
  }
  return null
}
