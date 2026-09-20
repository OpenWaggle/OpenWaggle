import fs from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'

const mutationLocks = new Map<string, Promise<void>>()
const networkLocks = new Map<string, Promise<void>>()

async function pathExists(candidate: string) {
  return fs.access(candidate).then(
    () => true,
    () => false,
  )
}

async function canonicalGitDirectory(gitEntry: string) {
  const entryStats = await fs.lstat(gitEntry).catch(() => null)
  if (entryStats?.isDirectory()) {
    return fs.realpath(gitEntry).catch(() => path.resolve(gitEntry))
  }
  if (!entryStats?.isFile()) return path.resolve(gitEntry)

  const pointer = await fs.readFile(gitEntry, 'utf8').catch(() => '')
  const gitDirValue = /^gitdir:\s*(.+)$/imu.exec(pointer)?.[1]?.trim()
  if (!gitDirValue) return path.resolve(gitEntry)
  const gitDir = path.resolve(path.dirname(gitEntry), gitDirValue)
  const commonDirValue = await fs
    .readFile(path.join(gitDir, 'commondir'), 'utf8')
    .then((value) => value.trim())
    .catch(() => '')
  const commonDir = commonDirValue ? path.resolve(gitDir, commonDirValue) : gitDir
  return fs.realpath(commonDir).catch(() => commonDir)
}

/** Resolve path aliases and opened subdirectories to one checkout without merging linked worktrees. */
export async function resolveGitWorktreeScope(workingPath: string) {
  const resolvedWorkingPath = await fs.realpath(workingPath).catch(() => path.resolve(workingPath))
  let candidate = resolvedWorkingPath
  while (true) {
    const gitEntry = path.join(candidate, '.git')
    if (await pathExists(gitEntry)) return candidate
    const parent = path.dirname(candidate)
    if (parent === candidate) return resolvedWorkingPath
    candidate = parent
  }
}

/** Resolve every linked worktree in one repository to its common Git directory. */
export async function resolveGitMutationScope(workingPath: string) {
  const checkoutPath = await resolveGitWorktreeScope(workingPath)
  const gitEntry = path.join(checkoutPath, '.git')
  return (await pathExists(gitEntry)) ? canonicalGitDirectory(gitEntry) : checkoutPath
}

async function acquireLockKey(locks: Map<string, Promise<void>>, key: string) {
  const previous = locks.get(key) ?? Promise.resolve()
  let releaseLock: (() => void) | undefined
  const next = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  locks.set(key, next)
  await previous
  return () => {
    releaseLock?.()
    if (locks.get(key) === next) locks.delete(key)
  }
}

async function acquireLocks(locks: Map<string, Promise<void>>, workingPaths: readonly string[]) {
  const canonicalPaths = await Promise.all(workingPaths.map(resolveGitMutationScope))
  const keys = [...new Set(canonicalPaths)].sort()
  const releases: Array<() => void> = []

  try {
    for (const key of keys) {
      releases.push(await acquireLockKey(locks, key))
    }
  } catch (error) {
    for (const release of releases.reverse()) release()
    throw error
  }

  return () => {
    for (const release of releases.reverse()) release()
  }
}

async function acquireMutationLock(workingPath: string) {
  return acquireLocks(mutationLocks, [workingPath])
}

/** Serialize promise-based mutations of the same checkout. */
export async function runWithGitMutationLock<T>(
  workingPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireMutationLock(workingPath)
  try {
    return await operation()
  } finally {
    release()
  }
}

/** Serialize a mutation spanning multiple canonical checkouts without lock-order deadlocks. */
export async function runWithGitMutationLocks<T>(
  workingPaths: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireLocks(mutationLocks, workingPaths)
  try {
    return await operation()
  } finally {
    release()
  }
}

/**
 * Serialize remote-ref/network operations without blocking local index, commit, or branch work.
 *
 * Background status fetches can stall for the full network timeout. Sharing the mutation lock made
 * a local Commit appear frozen behind that fetch even though Git safely uses independent ref/index
 * locks for those operations. Push and pull use this scope too, so app-initiated network writes stay
 * ordered while local work remains responsive.
 */
export async function runWithGitNetworkLock<T>(
  workingPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireLocks(networkLocks, [workingPath])
  try {
    return await operation()
  } finally {
    release()
  }
}

/** Serialize Effect-based mutations of the same checkout. */
export function withGitMutationLock<A, E, R>(
  workingPath: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.promise(() => acquireMutationLock(workingPath)),
    () => effect,
    (release) => Effect.sync(release),
  )
}
