import { runGit } from '../../adapters/git/run-git'

/**
 * The repository root that a whole-repository mutation will actually affect.
 *
 * Revert all is deliberately re-based onto the root and uses whole-repository pathspecs, so when
 * the user opened a subdirectory (normal in a monorepo) it discards tracked changes and deletes
 * untracked files they never had in view. The confirmation has to be able to say that.
 */
export async function resolveRepositoryRoot(projectPath: string): Promise<string | null> {
  const result = await runGit(projectPath, ['rev-parse', '--show-toplevel'])
  if (result.code !== 0) return null
  const root = result.stdout.replace(/\r?\n$/, '').trim()
  return root.length > 0 ? root : null
}
