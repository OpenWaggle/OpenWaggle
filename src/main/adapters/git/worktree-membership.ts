import { lstat, readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
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
 * The `.git` file this worktree's git dir was made for, as `<gitDir>/gitdir` records it. Git 2.48
 * and later write it relative to the git dir when `worktree.useRelativePaths` is set.
 */
async function registeredDotGit(gitDir: string) {
  try {
    const recorded = (await readFile(join(gitDir, 'gitdir'), 'utf8')).trim()
    return recorded ? await realpath(resolve(gitDir, recorded)) : null
  } catch (error) {
    if (isEnoent(error)) return null
    throw error
  }
}

/**
 * Whether `candidatePath` is a finished linked worktree of the repository at `projectPath`.
 *
 * - It shares the repository's common git dir, as the agent birth path checks (`isWorktreeOf`).
 * - It has a git dir of its own, so a plain folder inside the main checkout is not one.
 * - It is the top of its worktree, so a folder inside another worktree is not one.
 * - Its git dir was registered for this folder's `.git`, so a `cp -R` copy of another live
 *   worktree, which would share that worktree's HEAD and index, is not one.
 * - That git dir has no `locked` file: `git worktree add` writes one ("initializing") before it
 *   checks files out and removes it after, so a half-written checkout is `locked`.
 */
export async function inspectLinkedWorktree(
  projectPath: string,
  candidatePath: string,
): Promise<LinkedWorktreeCheck> {
  const [candidate, primary] = await Promise.all([
    runGit(candidatePath, [...COMMON_DIR, '--git-dir', '--show-toplevel']),
    runGit(projectPath, COMMON_DIR),
  ])
  if (candidate.code !== 0 || primary.code !== 0) return 'not-a-worktree'
  const [commonDir = '', gitDir = '', topLevel = ''] = candidate.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
  const primaryCommonDir = primary.stdout.trim()
  if (!commonDir || commonDir !== primaryCommonDir || !gitDir || gitDir === commonDir || !topLevel)
    return 'not-a-worktree'
  const folder = await realpath(candidatePath)
  if ((await realpath(topLevel)) !== folder) return 'not-a-worktree'
  if ((await registeredDotGit(gitDir)) !== join(folder, '.git')) return 'not-a-worktree'
  return (await lockExists(gitDir)) ? 'locked' : 'linked'
}
