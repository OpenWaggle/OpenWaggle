import fs from 'node:fs/promises'
import path from 'node:path'
import {
  removeUnretainedScratchDirectory,
  sessionScratchDirectoryPath,
  sessionScratchRoot,
} from './session-scratch-directory'

const HOUR_MS = 60 * 60 * 1000
/** A directory this young may belong to a Session created after the sweep read the catalog. */
const SWEEP_MINIMUM_AGE_MS = HOUR_MS
/** Another profile's namespace untouched this long belongs to a profile that no longer runs. */
const ABANDONED_NAMESPACE_AGE_MS = 7 * 24 * HOUR_MS

function hasErrorCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code
}

async function isOwnedPrivateDirectory(directory: string) {
  const stats = await fs.lstat(directory)
  const uid = process.getuid?.()
  return stats.isDirectory() && !stats.isSymbolicLink() && (uid === undefined || stats.uid === uid)
}

async function newestModification(directory: string) {
  const stats = await fs.lstat(directory)
  let newest = stats.mtimeMs
  for (const name of await fs.readdir(directory)) {
    const child = await fs.lstat(path.join(directory, name)).catch(() => undefined)
    if (child) newest = Math.max(newest, child.mtimeMs)
  }
  return newest
}

/**
 * Remove other profiles' namespaces that nothing has touched for a week. Throwaway profiles such
 * as `pnpm dev:debug` runs get a fresh namespace each time and no Host ever sweeps it again.
 */
async function sweepAbandonedNamespaces(root: string, now: number) {
  const userDirectory = path.dirname(root)
  const ownNamespace = path.basename(root)
  let removed = 0
  for (const name of await fs.readdir(userDirectory)) {
    if (name === ownNamespace) continue
    const namespace = path.join(userDirectory, name)
    if (!(await isOwnedPrivateDirectory(namespace).catch(() => false))) continue
    const newest = await newestModification(namespace).catch(() => now)
    if (now - newest < ABANDONED_NAMESPACE_AGE_MS) continue
    const gone = await fs.rm(namespace, { recursive: true, force: true }).then(
      () => true,
      () => false,
    )
    if (gone) removed += 1
  }
  return removed
}

/**
 * Remove scratch directories whose Session is gone or archived. Archive and delete remove the
 * directory while the Host runs; this catches Sessions deleted while it was down or left behind by
 * a failed removal. Directories in use by a Run, or too young to rule out a new Session, are kept.
 * Other profiles' namespaces are removed only once abandoned for a week. Returns the number of
 * directories removed.
 */
export async function sweepSessionScratchDirectories(
  liveSessionIds: Iterable<string>,
  root = sessionScratchRoot(),
  now = Date.now(),
) {
  const live = new Set(
    Array.from(liveSessionIds, (sessionId) =>
      path.basename(sessionScratchDirectoryPath(sessionId, root)),
    ),
  )
  let entries: string[]
  try {
    if (!(await isOwnedPrivateDirectory(path.dirname(root)))) return 0
    entries = (await isOwnedPrivateDirectory(root).catch(() => false)) ? await fs.readdir(root) : []
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return 0
    throw error
  }
  let removed = 0
  for (const name of entries) {
    if (live.has(name)) continue
    const directory = path.join(root, name)
    const stats = await fs.lstat(directory).catch(() => undefined)
    if (!stats?.isDirectory() || stats.isSymbolicLink()) continue
    if (now - stats.mtimeMs < SWEEP_MINIMUM_AGE_MS) continue
    // Retention is checked after the awaits above, right before removing. One directory that
    // cannot be removed (for example a read-only file a tool left) does not stop the sweep.
    if (await removeUnretainedScratchDirectory(directory)) removed += 1
  }
  return removed + (await sweepAbandonedNamespaces(root, now))
}
