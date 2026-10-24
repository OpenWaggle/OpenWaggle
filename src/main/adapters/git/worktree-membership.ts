import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { isEnoent } from '@shared/utils/node-error'
import type { LinkedWorktreeCheck } from '../../ports/git-worktree-service'
import { runGit } from './run-git'

const COMMON_DIR = ['rev-parse', '--path-format=absolute', '--git-common-dir']

async function lockExists(gitDir: string) {
  try {
    await lstat(join(gitDir, 'locked'))
    return true
  } catch (error) {
    if (isEnoent(error)) return false
    throw error
  }
}

/**
 * Whether `candidatePath` is a finished linked worktree of the repository at `projectPath`.
 *
 * It shares the repository's common git dir, as the agent birth path checks (`isWorktreeOf`),
 * and has a git dir of its own, so a plain folder inside the main checkout is not one. A
 * `locked` file in that git dir means `git worktree add` has not finished: Git writes it
 * ("initializing") before checking files out and removes it after.
 */
export async function inspectLinkedWorktree(
  projectPath: string,
  candidatePath: string,
): Promise<LinkedWorktreeCheck> {
  const [candidate, primary] = await Promise.all([
    runGit(candidatePath, [...COMMON_DIR, '--git-dir']),
    runGit(projectPath, COMMON_DIR),
  ])
  if (candidate.code !== 0 || primary.code !== 0) return 'not-a-worktree'
  const [commonDir = '', gitDir = ''] = candidate.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
  const primaryCommonDir = primary.stdout.trim()
  if (!commonDir || commonDir !== primaryCommonDir || !gitDir || gitDir === commonDir)
    return 'not-a-worktree'
  return (await lockExists(gitDir)) ? 'locked' : 'linked'
}
