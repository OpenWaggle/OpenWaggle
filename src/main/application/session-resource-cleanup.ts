import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { SessionResourceCleanupRepository } from '../ports/session-resource-cleanup-repository'
import { SessionResourceStore } from '../ports/session-resource-store'
import { withSessionResourceLock } from './session-resource-lock'

export const SESSION_RESOURCE_CLEANUP_BATCH_SIZE = 100

export function cleanupQueuedSessionResources(sessionId: SessionId) {
  return Effect.gen(function* () {
    const cleanup = yield* SessionResourceCleanupRepository
    const store = yield* SessionResourceStore
    yield* withSessionResourceLock(
      sessionId,
      store.removeSession(sessionId).pipe(Effect.zipRight(cleanup.complete(sessionId))),
    )
  })
}

export function cleanupPendingSessionResources() {
  return Effect.gen(function* () {
    const cleanup = yield* SessionResourceCleanupRepository
    const pending = yield* cleanup.listPending(SESSION_RESOURCE_CLEANUP_BATCH_SIZE)
    yield* Effect.forEach(
      pending,
      (sessionId) =>
        cleanupQueuedSessionResources(sessionId).pipe(Effect.catchAll(() => Effect.void)),
      { concurrency: 1, discard: true },
    )
  })
}

export function cleanupPendingSessionResourcesSafely() {
  return cleanupPendingSessionResources().pipe(Effect.catchAll(() => Effect.void))
}
