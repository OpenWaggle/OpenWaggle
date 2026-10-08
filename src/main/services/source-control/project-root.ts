import path from 'node:path'
import { runGit } from '../../adapters/git/run-git'
import { resolveRepositoryRoot } from '../git/repository-root'

async function readCommonDir(workingPath: string) {
  const result = await runGit(workingPath, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ])
  return result.code === 0 ? result.stdout.trim() : ''
}

/**
 * The key every per-project source-control setting is stored under: the repository's main
 * checkout, so the Session Summary, Settings, and the agent tool agree whichever folder,
 * worktree, or path spelling they start from (ADR 0048). A worktree of a bare repository has no
 * main checkout, so its own work tree is the project.
 */
export async function projectSettingsKey(projectPath: string): Promise<string> {
  const commonDir = await readCommonDir(projectPath)
  if (!commonDir) return path.resolve(projectPath)
  if (path.basename(commonDir) === '.git') return path.resolve(path.dirname(commonDir))
  const workTree = await resolveRepositoryRoot(projectPath)
  return path.resolve(workTree ?? projectPath)
}
