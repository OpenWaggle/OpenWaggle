import fs from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'

const locks = new Map<string, Promise<void>>()

async function canonicalWorkingPath(workingPath: string) {
  return fs.realpath(workingPath).catch(() => path.resolve(workingPath))
}

async function acquireMutationLock(workingPath: string) {
  const key = await canonicalWorkingPath(workingPath)
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

/** Serializes every main-process mutation of the same canonical checkout or worktree. */
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
