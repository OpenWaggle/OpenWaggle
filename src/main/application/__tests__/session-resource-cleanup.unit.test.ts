import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import {
  type SessionResourceCleanupCursor,
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
                return [
                  { sessionId: first, queuedAt: 1 },
                  { sessionId: second, queuedAt: 2 },
                ]
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

  it('drains later batches when the oldest cleanup keeps failing', async () => {
    const queued = Array.from({ length: SESSION_RESOURCE_CLEANUP_BATCH_SIZE + 1 }, (_, index) => ({
      sessionId: SessionId(`session-${String(index).padStart(3, '0')}`),
      queuedAt: index,
    }))
    const requestedCursors: Array<SessionResourceCleanupCursor | undefined> = []
    const removed: SessionId[] = []
    const completed: SessionId[] = []
    const layer = Layer.mergeAll(
      Layer.succeed(
        SessionResourceCleanupRepository,
        SessionResourceCleanupRepository.of(
          fromPartial<SessionResourceCleanupRepositoryShape>({
            listPending: (limit: number, after?: SessionResourceCleanupCursor) =>
              Effect.sync(() => {
                requestedCursors.push(after)
                const start = after
                  ? queued.findIndex(
                      (entry) =>
                        entry.queuedAt > after.queuedAt ||
                        (entry.queuedAt === after.queuedAt && entry.sessionId > after.sessionId),
                    )
                  : 0
                return start < 0 ? [] : queued.slice(start, start + limit)
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
                if (sessionId === queued[0]?.sessionId) {
                  yield* Effect.fail(new Error('permanent disk failure'))
                }
              }),
          }),
        ),
      ),
    )

    await Effect.runPromise(cleanupPendingSessionResources().pipe(Effect.provide(layer)))

    expect(requestedCursors).toEqual([undefined, queued[SESSION_RESOURCE_CLEANUP_BATCH_SIZE - 1]])
    expect(removed).toEqual(queued.map(({ sessionId }) => sessionId))
    expect(completed).toEqual(queued.slice(1).map(({ sessionId }) => sessionId))
  })
})
