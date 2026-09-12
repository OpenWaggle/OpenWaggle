import * as Effect from 'effect/Effect'

interface ProfileMutationSemaphoreEntry {
  readonly semaphore: Effect.Semaphore
  users: number
}

const profileMutationSemaphores = new Map<string, ProfileMutationSemaphoreEntry>()

function acquireProfileMutationSemaphore(profileName: string) {
  return Effect.sync(() => {
    const existing = profileMutationSemaphores.get(profileName)
    if (existing) {
      existing.users += 1
      return existing
    }
    const created = { semaphore: Effect.runSync(Effect.makeSemaphore(1)), users: 1 }
    profileMutationSemaphores.set(profileName, created)
    return created
  })
}

function releaseProfileMutationSemaphore(
  profileName: string,
  entry: ProfileMutationSemaphoreEntry,
) {
  return Effect.sync(() => {
    entry.users -= 1
    if (entry.users === 0 && profileMutationSemaphores.get(profileName) === entry) {
      profileMutationSemaphores.delete(profileName)
    }
  })
}

export function withLocalSessionProfileMutationLock<A, E, R>(
  profileName: string,
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    acquireProfileMutationSemaphore(profileName),
    (entry) => effect.pipe(entry.semaphore.withPermits(1)),
    (entry) => releaseProfileMutationSemaphore(profileName, entry),
  )
}
