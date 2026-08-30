import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import {
  SessionResourceCleanupRepository,
  type SessionResourceCleanupRepositoryShape,
} from '../../ports/session-resource-cleanup-repository'
import {
  SessionResourceStore,
  type SessionResourceStoreShape,
} from '../../ports/session-resource-store'
import {
  cleanupPendingSessionResources,
  SESSION_RESOURCE_CLEANUP_BATCH_SIZE,
} from '../session-resource-cleanup'

describe('session resource cleanup reconciliation', () => {
  it('retains failed cleanup work while completing later queued sessions', async () => {
    const first = SessionId('session-first')
    const second = SessionId('session-second')
    const requestedLimits: number[] = []
    const removed: SessionId[] = []
    const completed: SessionId[] = []
    const layer = Layer.mergeAll(
      Layer.succeed(
        SessionResourceCleanupRepository,
        SessionResourceCleanupRepository.of(
          fromPartial<SessionResourceCleanupRepositoryShape>({
            listPending: (limit: number) =>
              Effect.sync(() => {
                requestedLimits.push(limit)
                return [first, second]
              }),
            complete: (sessionId: SessionId) =>
              Effect.sync(() => {
                completed.push(sessionId)
              }),
          }),
        ),
      ),
      Layer.succeed(
        SessionResourceStore,
        SessionResourceStore.of(
          fromPartial<SessionResourceStoreShape>({
            removeSession: (sessionId: SessionId) =>
              Effect.gen(function* () {
                removed.push(sessionId)
                if (sessionId === first) yield* Effect.fail(new Error('disk is busy'))
              }),
          }),
        ),
      ),
    )

    await Effect.runPromise(cleanupPendingSessionResources().pipe(Effect.provide(layer)))

    expect(requestedLimits).toEqual([SESSION_RESOURCE_CLEANUP_BATCH_SIZE])
    expect(removed).toEqual([first, second])
    expect(completed).toEqual([second])
  })
})
