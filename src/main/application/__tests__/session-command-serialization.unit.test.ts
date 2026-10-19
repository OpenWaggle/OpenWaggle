import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { describe, expect, it } from 'vitest'
import {
  releaseSessionCommandSerializationWhile,
  withSessionCommandSerialization,
} from '../session-command-serialization'

/** Serialized work runs uninterruptibly in places, so race rather than use an Effect timeout. */
function within<A>(promise: Promise<A>, message: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), 1_000)),
  ])
}

describe('Session command serialization', () => {
  it('admits another command for the Session while the holder steps aside', async () => {
    const sessionId = 'session-steps-aside'
    const steppedAside = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const order: string[] = []
    const holder = Effect.runPromise(
      withSessionCommandSerialization(
        sessionId,
        Effect.gen(function* () {
          order.push('holder:start')
          yield* releaseSessionCommandSerializationWhile({
            sessionId,
            effect: Effect.promise(async () => {
              steppedAside.resolve()
              await resume.promise
            }),
          })
          order.push('holder:end')
        }),
      ),
    )
    await steppedAside.promise
    await within(
      Effect.runPromise(
        withSessionCommandSerialization(
          sessionId,
          Effect.sync(() => order.push('other')),
        ),
      ),
      'The other command waited for the holder that stepped aside.',
    )
    resume.resolve()
    await holder
    expect(order).toEqual(['holder:start', 'other', 'holder:end'])
  })

  it('takes the serialization back before the holder continues', async () => {
    const sessionId = 'session-takes-back'
    const steppedAside = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const otherEntered = Promise.withResolvers<void>()
    const finishOther = Promise.withResolvers<void>()
    const order: string[] = []
    const holder = Effect.runPromise(
      withSessionCommandSerialization(
        sessionId,
        Effect.gen(function* () {
          yield* releaseSessionCommandSerializationWhile({
            sessionId,
            effect: Effect.promise(async () => {
              steppedAside.resolve()
              await resume.promise
            }),
          })
          order.push('holder:continued')
        }),
      ),
    )
    await steppedAside.promise
    const other = Effect.runPromise(
      withSessionCommandSerialization(
        sessionId,
        Effect.promise(async () => {
          otherEntered.resolve()
          await finishOther.promise
          order.push('other:end')
        }),
      ),
    )
    await otherEntered.promise
    resume.resolve()
    // The holder's work is done, but it may not continue while the other command still runs.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(order).toEqual([])
    finishOther.resolve()
    await Promise.all([holder, other])
    expect(order).toEqual(['other:end', 'holder:continued'])
  })

  it('runs the effect unchanged when the fiber holds no serialization of the Session', async () => {
    await expect(
      Effect.runPromise(
        withSessionCommandSerialization(
          'session-held',
          releaseSessionCommandSerializationWhile({
            sessionId: 'session-other',
            effect: Effect.succeed('ran'),
          }),
        ),
      ),
    ).resolves.toBe('ran')
    await expect(
      Effect.runPromise(
        releaseSessionCommandSerializationWhile({
          sessionId: 'session-none',
          effect: Effect.succeed('ran'),
        }),
      ),
    ).resolves.toBe('ran')
  })

  it('does not let a forked fiber step aside from its parent serialization', async () => {
    const sessionId = 'session-forked'
    const childSteppedAside = Promise.withResolvers<void>()
    const finishChild = Promise.withResolvers<void>()
    const holder = Effect.runPromise(
      withSessionCommandSerialization(
        sessionId,
        Effect.gen(function* () {
          const child = yield* Effect.fork(
            releaseSessionCommandSerializationWhile({
              sessionId,
              effect: Effect.promise(async () => {
                childSteppedAside.resolve()
                await finishChild.promise
              }),
            }),
          )
          yield* Effect.promise(() => childSteppedAside.promise)
          // The parent still holds the Session: another command must keep waiting.
          const otherFiber = yield* Effect.fork(
            withSessionCommandSerialization(sessionId, Effect.succeed(true)),
          )
          yield* Effect.sleep('20 millis')
          const otherRan = yield* Fiber.poll(otherFiber)
          finishChild.resolve()
          yield* Fiber.join(child)
          return otherRan
        }),
      ),
    )
    const otherRan = await holder
    expect(otherRan._tag).toBe('None')
  })

  it('releases the serialization when the stepped-aside effect fails', async () => {
    const sessionId = 'session-step-aside-fails'
    await expect(
      Effect.runPromise(
        withSessionCommandSerialization(
          sessionId,
          releaseSessionCommandSerializationWhile({
            sessionId,
            effect: Effect.fail(new Error('steering failed')),
          }),
        ),
      ),
    ).rejects.toThrow('steering failed')
    await within(
      Effect.runPromise(withSessionCommandSerialization(sessionId, Effect.void)),
      'A failed step-aside left the Session serialized.',
    )
  })
})
