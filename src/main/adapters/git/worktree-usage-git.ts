import { realpath } from 'node:fs/promises'
import { runGit } from './run-git'

const DECIMAL_RADIX = 10

/**
 * Commits reachable from the worktree's HEAD that no remote-tracking ref has, i.e. work that only
 * this checkout's branch holds. Null when Git cannot tell.
 */
export async function countUnpublishedCommits(worktreePath: string): Promise<number | null> {
  const result = await runGit(worktreePath, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
  if (result.code !== 0) return null
  const count = Number.parseInt(result.stdout.trim(), DECIMAL_RADIX)
  return Number.isFinite(count) && count >= 0 ? count : null
}

/** The checkout a folder belongs to, by its canonical top-level path; null outside Git. */
export async function checkoutTopLevel(folder: string): Promise<string | null> {
  const result = await runGit(folder, ['rev-parse', '--show-toplevel'])
  const topLevel = result.code === 0 ? result.stdout.trim() : ''
  if (!topLevel) return null
  try {
    return await realpath(topLevel)
  } catch {
    return topLevel
  }
}
