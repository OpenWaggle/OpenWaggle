import { realpath } from 'node:fs/promises'
import { runGit } from './run-git'

const DECIMAL_RADIX = 10
/** A status that takes longer than this reports unknown, so one stuck worktree cannot stall the list. */
const STATUS_TIMEOUT_MS = 30_000

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

/**
 * Changed, staged and untracked entries in a worktree, as `git status` lists them (an untracked
 * folder counts once). Ignored files are not counted. Null when Git cannot tell.
 */
export async function countUncommittedChanges(worktreePath: string): Promise<number | null> {
  /*
   * `--no-optional-locks`: the page reads every worktree, including ones a Run is using, and
   * must not take `index.lock` to refresh the index. `--untracked-files=normal` overrides a
   * `status.showUntrackedFiles=no` setting, which would make new files look safe to delete.
   */
  const result = await runGit(
    worktreePath,
    ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'],
    { timeoutMs: STATUS_TIMEOUT_MS },
  )
  if (result.code !== 0) return null
  // `-z` ends each entry with NUL; a rename or copy, staged (X) or in the worktree (Y), adds
  // its source path as one more NUL-ended field.
  let count = 0
  const fields = result.stdout.split('\0')
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? ''
    if (field.length === 0) continue
    count += 1
    if (/^[RC]|^.[RC]/.test(field)) index += 1
  }
  return count
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
