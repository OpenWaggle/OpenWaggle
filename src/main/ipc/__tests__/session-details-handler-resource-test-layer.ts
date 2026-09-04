import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { type Mock, vi } from 'vitest'
import { SessionResourceStoreError } from '../../errors'
import { SessionResourceCleanupRepository } from '../../ports/session-resource-cleanup-repository'
import { SessionResourceStore } from '../../ports/session-resource-store'

export const removeSessionResourcesMock: Mock = vi.fn()
export const completeSessionResourceCleanupMock: Mock = vi.fn()
const listPendingSessionResourceCleanupMock = vi.fn()

const TestSessionResourceStoreLayer = Layer.succeed(SessionResourceStore, {
  storeBytes: () => Effect.dieMessage('storeBytes is not used'),
  storeFile: () => Effect.dieMessage('storeFile is not used'),
  inspect: () => Effect.dieMessage('inspect is not used'),
  read: () => Effect.dieMessage('read is not used'),
  remove: () => Effect.dieMessage('remove is not used'),
  removeSession: (sessionId) =>
    Effect.tryPromise({
      try: async () => {
        await removeSessionResourcesMock(sessionId)
      },
      catch: (cause) => new SessionResourceStoreError({ operation: 'removeSession', cause }),
    }),
})

const TestSessionResourceCleanupLayer = Layer.succeed(SessionResourceCleanupRepository, {
  listPending: (limit) => Effect.sync(() => listPendingSessionResourceCleanupMock(limit)),
  complete: (sessionId) =>
    Effect.sync(() => {
      completeSessionResourceCleanupMock(sessionId)
    }),
})

export const TestSessionResourceLayer = Layer.merge(
  TestSessionResourceStoreLayer,
  TestSessionResourceCleanupLayer,
)

export function resetSessionResourceTestMocks(): void {
  removeSessionResourcesMock.mockReset().mockReturnValue(undefined)
  completeSessionResourceCleanupMock.mockReset()
  listPendingSessionResourceCleanupMock.mockReset().mockReturnValue([])
}
