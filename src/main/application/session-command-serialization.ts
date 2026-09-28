import * as Effect from 'effect/Effect'

interface SessionSemaphoreEntry {
  readonly semaphore: Effect.Semaphore
  users: number
}

const sessionSemaphores = new Map<string, SessionSemaphoreEntry>()

function acquireSessionSemaphore(sessionId: string) {
  return Effect.sync(() => {
    const existing = sessionSemaphores.get(sessionId)
    if (existing) {
      existing.users += 1
      return existing
    }
    const created = { semaphore: Effect.runSync(Effect.makeSemaphore(1)), users: 1 }
    sessionSemaphores.set(sessionId, created)
    return created
  })
}

function releaseSessionSemaphore(sessionId: string, entry: SessionSemaphoreEntry) {
  return Effect.sync(() => {
    entry.users -= 1
    if (entry.users === 0 && sessionSemaphores.get(sessionId) === entry) {
      sessionSemaphores.delete(sessionId)
    }
  })
}

/**
 * Serialize one Session Control mutation against every other serialized mutation of the same
 * Session. Host-initiated mutations (such as Hive cleanup) use it so their precondition check and
 * write cannot interleave with a concurrently submitted command.
 */
export function withSessionCommandSerialization<A, E, R>(
  sessionId: string,
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    acquireSessionSemaphore(sessionId),
    (entry) => effect.pipe(entry.semaphore.withPermits(1)),
    (entry) => releaseSessionSemaphore(sessionId, entry),
  )
}
