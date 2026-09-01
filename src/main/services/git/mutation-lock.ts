import fs from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'

const locks = new Map<string, Promise<void>>()

async function pathExists(candidate: string) {
  return fs.access(candidate).then(
    () => true,
    () => false,
  )
}

/** Resolve every folder inside one checkout to the same lock identity. */
async function canonicalCheckoutPath(workingPath: string) {
  let candidate = await fs.realpath(workingPath).catch(() => path.resolve(workingPath))
  while (true) {
    if (await pathExists(path.join(candidate, '.git'))) return candidate
    const parent = path.dirname(candidate)
    if (parent === candidate) return candidate
    candidate = parent
  }
}

async function acquireMutationLock(workingPath: string) {
  const key = await canonicalCheckoutPath(workingPath)
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
