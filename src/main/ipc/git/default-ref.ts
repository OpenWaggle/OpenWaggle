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
 * Branch names conventionally used for a default branch, tried in order when the repository
 * advertises nothing. A local-only repository created with `git init -b main` sets no
 * `init.defaultBranch`, so without this an obvious default would go unresolved and the
 * Automatic base ref would silently degrade to the working-tree diff.
 */
const CONVENTIONAL_DEFAULT_BRANCHES = ['main', 'master'] as const

/**
 * A revision for the default branch that actually exists in this repository.
 *
 * Resolution order, each verified to exist before it is used:
 * 1. the remote-tracking copy of what the remote advertises (`origin/<ref>`), because that is
 *    what "how does my work differ from the default branch" means to a reviewer,
 * 2. the local branch of that same ref, for a repository with no remote copy yet,
 * 3. a conventional default (`main`, then `master`) for a local-only repository,
 * 4. null - no default branch is present at all, so callers must decide what to do.
 *
 * Deliberately independent of ambient global git config beyond what `resolveDefaultRef`
 * reads, so behaviour does not change between a developer machine and a fresh CI runner.
 */
export async function resolveDefaultBranchRevision(projectPath: string): Promise<string | null> {
  const defaultRef = await resolveDefaultRef(projectPath)
  const candidates = [
    ...(defaultRef === null ? [] : [`origin/${defaultRef}`, defaultRef]),
    ...CONVENTIONAL_DEFAULT_BRANCHES,
  ]

  for (const candidate of candidates) {
    const verify = await runGit(projectPath, ['rev-parse', '--verify', `${candidate}^{commit}`])
    if (verify.code === 0) return candidate
  }
  return null
}
