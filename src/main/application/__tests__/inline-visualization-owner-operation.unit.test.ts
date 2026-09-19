import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import { withInlineVisualizationOwnerOperation } from '../inline-visualization-owner-operation'

it('releases cancelled waiters without overlapping the owner or blocking other Sessions', async () => {
  const sessionId = SessionId('serialized-visualization-owner')
  const started = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const first = Effect.runPromise(
    withInlineVisualizationOwnerOperation(
      sessionId,
      Effect.promise(async () => {
        started.resolve()
        await finish.promise
      }),
    ),
  )
  await started.promise
  const controller = new AbortController()
  let cancelledEntered = false
  const cancelled = Effect.runPromiseExit(
    withInlineVisualizationOwnerOperation(
      sessionId,
      Effect.sync(() => {
        cancelledEntered = true
      }),
    ),
    { signal: controller.signal },
  )
  controller.abort()
  expect((await cancelled)._tag).toBe('Failure')
  await expect(
    Effect.runPromise(
      withInlineVisualizationOwnerOperation(SessionId('unrelated-session'), Effect.succeed('free')),
    ),
  ).resolves.toBe('free')
  let nextEntered = false
  const next = Effect.runPromise(
    withInlineVisualizationOwnerOperation(
      sessionId,
      Effect.sync(() => {
        nextEntered = true
      }),
    ),
  )
  expect(nextEntered).toBe(false)
  finish.resolve()
  await Promise.all([first, next])
  expect(cancelledEntered).toBe(false)
  expect(nextEntered).toBe(true)
  await expect(
    Effect.runPromise(withInlineVisualizationOwnerOperation(sessionId, Effect.succeed('released'))),
  ).resolves.toBe('released')
})
