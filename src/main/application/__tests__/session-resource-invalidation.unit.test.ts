import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import {
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
  type UpsertSessionResourceInput,
} from '../../ports/session-resource-repository'
import {
  publishSessionResourceInvalidation,
  subscribeToSessionResourceInvalidations,
  withSessionResourceInvalidation,
} from '../session-resource-invalidation'

const SESSION_ID = SessionId('session-one')

function input(id: string): UpsertSessionResourceInput {
  return {
    id,
    sessionId: SESSION_ID,
    canonicalKey: `url:https://example.test/${id}`,
    kind: 'link',
    title: id,
    mimeType: null,
    locator: `https://example.test/${id}`,
    managedPath: null,
    available: true,
    occurrence: {
      id: `occurrence-${id}`,
      nodeId: null,
      branchId: null,
      actor: 'agent',
      activity: 'read',
      label: null,
      createdAt: 1,
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

const repositoryLayer = Layer.succeed(
  SessionResourceRepository,
  SessionResourceRepository.of(
    fromPartial<SessionResourceRepositoryShape>({
      upsert: (value: UpsertSessionResourceInput) =>
        Effect.succeed({
          ...value,
          isSource: true,
          isOutput: false,
          occurrences: [value.occurrence],
        }),
    }),
  ),
)

describe('session resource invalidation', () => {
  it('publishes the exact owning Session and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToSessionResourceInvalidations(listener)

    publishSessionResourceInvalidation(SessionId('session-one'))
    unsubscribe()
    publishSessionResourceInvalidation(SessionId('session-two'))

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({ sessionId: SessionId('session-one') })
  })

  it('isolates listeners so one failure cannot block the others', () => {
    const failed = vi.fn(() => {
      throw new Error('listener failed')
    })
    const received = vi.fn()
    const unsubscribeFailed = subscribeToSessionResourceInvalidations(failed)
    const unsubscribeReceived = subscribeToSessionResourceInvalidations(received)

    publishSessionResourceInvalidation(SessionId('session-one'))
    unsubscribeFailed()
    unsubscribeReceived()

    expect(failed).toHaveBeenCalledOnce()
    expect(received).toHaveBeenCalledWith({ sessionId: SessionId('session-one') })
  })

  it('coalesces a successful persistence batch into one invalidation', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToSessionResourceInvalidations(listener)

    await Effect.runPromise(
      withSessionResourceInvalidation(
        SESSION_ID,
        Effect.gen(function* () {
          const repository = yield* SessionResourceRepository
          yield* repository.upsert(input('one'))
          yield* repository.upsert(input('two'))
        }),
      ).pipe(Effect.provide(repositoryLayer)),
    )
    unsubscribe()

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({ sessionId: SESSION_ID })
  })

  it('does not invalidate when a batch persists no resources', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToSessionResourceInvalidations(listener)

    await Effect.runPromise(
      withSessionResourceInvalidation(SESSION_ID, Effect.void).pipe(
        Effect.provide(repositoryLayer),
      ),
    )
    unsubscribe()

    expect(listener).not.toHaveBeenCalled()
  })
})
