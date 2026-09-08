import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'

interface OwnerOperationEntry {
  readonly semaphore: Effect.Semaphore
  users: number
}

const ownerOperations = new Map<SessionId, OwnerOperationEntry>()

/** Serialize source recovery and deletion without reserving the active Pi writer. */
export function withInlineVisualizationOwnerOperation<A, E, R>(
  sessionId: SessionId,
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const entry = ownerOperations.get(sessionId) ?? {
        semaphore: Effect.runSync(Effect.makeSemaphore(1)),
        users: 0,
      }
      entry.users += 1
      ownerOperations.set(sessionId, entry)
      return entry
    }),
    (entry) => effect.pipe(entry.semaphore.withPermits(1)),
    (entry) =>
      Effect.sync(() => {
        entry.users -= 1
        if (entry.users === 0 && ownerOperations.get(sessionId) === entry) {
          ownerOperations.delete(sessionId)
        }
      }),
  )
}
