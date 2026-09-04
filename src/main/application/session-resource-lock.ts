import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'

const locks = new Map<SessionId, Promise<void>>()

async function acquireResourceLock(sessionId: SessionId) {
  const previous = locks.get(sessionId) ?? Promise.resolve()
  let releaseLock: (() => void) | undefined
  const next = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  locks.set(sessionId, next)
  await previous
  return () => {
    releaseLock?.()
    if (locks.get(sessionId) === next) locks.delete(sessionId)
  }
}

/** Serializes resource capture, backfill, and permanent resource deletion per session. */
export function withSessionResourceLock<A, E, R>(
  sessionId: SessionId,
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.promise(() => acquireResourceLock(sessionId)),
    () => effect,
    (release) => Effect.sync(release),
  )
}
