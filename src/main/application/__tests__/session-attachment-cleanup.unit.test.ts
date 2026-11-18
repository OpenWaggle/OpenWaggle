import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import { describe, expect, it } from 'vitest'
import {
  lendSessionAttachmentTransitionToSettlingRun,
  preserveOutcomeAfterAttachmentCleanup,
  withSessionAttachmentTransition,
} from '../session-attachment-cleanup'

describe('Session attachment cleanup outcome preservation', () => {
  it('serializes attachment transitions and cleanup for the same Session', async () => {
    const firstStarted = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    const order: string[] = []
    const first = Effect.runPromise(
      withSessionAttachmentTransition({
        sessionId: 'session-transition',
        effect: Effect.promise(async () => {
          order.push('bind-started')
          firstStarted.resolve()
          await releaseFirst.promise
          order.push('intent-durable')
        }),
      }),
    )
    await firstStarted.promise

    const cleanup = Effect.runPromise(
      withSessionAttachmentTransition({
        sessionId: 'session-transition',
        effect: Effect.sync(() => order.push('cleanup')),
      }),
    )
    await Promise.resolve()
    expect(order).toEqual(['bind-started'])

    releaseFirst.resolve()
    await Promise.all([first, cleanup])
    expect(order).toEqual(['bind-started', 'intent-durable', 'cleanup'])
  })

  it('promptly removes an aborted waiter while another transition remains held', async () => {
    const firstStarted = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    const first = Effect.runPromise(
      withSessionAttachmentTransition({
        sessionId: 'session-aborted-transition',
        effect: Effect.promise(async () => {
          firstStarted.resolve()
          await releaseFirst.promise
        }),
      }),
    )
    await firstStarted.promise

    const controller = new AbortController()
    let waiterRan = false
    const waiter = Effect.runPromise(
      withSessionAttachmentTransition({
        sessionId: 'session-aborted-transition',
        signal: controller.signal,
        effect: Effect.sync(() => {
          waiterRan = true
        }),
      }),
    )
    controller.abort()

    await expect(waiter).rejects.toThrow('cancelled')
    expect(waiterRan).toBe(false)
    releaseFirst.resolve()
    await first
  })

  it('removes an interrupted Effect waiter without waiting for the holder to release', async () => {
    const firstStarted = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    const first = Effect.runPromise(
      withSessionAttachmentTransition({
        sessionId: 'session-interrupted-transition',
        effect: Effect.promise(async () => {
          firstStarted.resolve()
          await releaseFirst.promise
        }),
      }),
    )
    await firstStarted.promise

    let interruptedWaiterRan = false
    const interruptedWaiter = Effect.runFork(
      withSessionAttachmentTransition({
        sessionId: 'session-interrupted-transition',
        effect: Effect.sync(() => {
          interruptedWaiterRan = true
        }),
      }),
    )
    await Effect.runPromise(Fiber.interrupt(interruptedWaiter))
    expect(interruptedWaiterRan).toBe(false)

    let laterWaiterRan = false
    const laterWaiter = Effect.runPromise(
      withSessionAttachmentTransition({
        sessionId: 'session-interrupted-transition',
        effect: Effect.sync(() => {
          laterWaiterRan = true
        }),
      }),
    )
    releaseFirst.resolve()
    await Promise.all([first, laterWaiter])
    expect(laterWaiterRan).toBe(true)
  })

  it('allows a same-fiber nested transition without surrendering the outer lock', async () => {
    const events: string[] = []

    await Effect.runPromise(
      withSessionAttachmentTransition({
        sessionId: 'session-reentrant-transition',
        effect: Effect.gen(function* () {
          events.push('outer')
          yield* withSessionAttachmentTransition({
            sessionId: 'session-reentrant-transition',
            effect: Effect.sync(() => events.push('inner')),
          })
          events.push('done')
        }),
      }),
    )

    expect(events).toEqual(['outer', 'inner', 'done'])
  })

  it('does not grant a forked child the parent fiber re-entrancy permission', async () => {
    const childAttempted = Promise.withResolvers<void>()
    const childFinished = Promise.withResolvers<void>()
    const releaseOuter = Promise.withResolvers<void>()
    let childEntered = false
    const outer = Effect.runPromise(
      withSessionAttachmentTransition({
        sessionId: 'session-forked-transition',
        effect: Effect.gen(function* () {
          yield* Effect.forkDaemon(
            Effect.sync(() => childAttempted.resolve()).pipe(
              Effect.zipRight(
                withSessionAttachmentTransition({
                  sessionId: 'session-forked-transition',
                  effect: Effect.sync(() => {
                    childEntered = true
                    childFinished.resolve()
                  }),
                }),
              ),
            ),
          )
          yield* Effect.promise(() => releaseOuter.promise)
        }),
      }),
    )

    await childAttempted.promise
    expect(childEntered).toBe(false)
    releaseOuter.resolve()
    await Promise.all([outer, childFinished.promise])
    expect(childEntered).toBe(true)
  })

  it('admits only the awaited Run teardown while a holder lends its transition', async () => {
    const sessionId = 'session-lent-transition'
    const events: string[] = []
    const teardownQueued = Promise.withResolvers<void>()
    const thirdPartyQueued = Promise.withResolvers<void>()
    const runSettled = Promise.withResolvers<void>()
    let teardown: Promise<unknown> | undefined
    let thirdParty: Promise<unknown> | undefined
    const holder = Effect.runPromise(
      withSessionAttachmentTransition({
        sessionId,
        effect: Effect.gen(function* () {
          events.push('holder-bound')
          // Both queue before the loan opens: the awaited Run's teardown and an unrelated cleanup.
          teardown = Effect.runPromise(
            withSessionAttachmentTransition({
              sessionId,
              settlingRunId: 'run-awaited',
              effect: Effect.sync(() => {
                events.push('teardown')
                runSettled.resolve()
              }),
            }),
          )
          thirdParty = Effect.runPromise(
            withSessionAttachmentTransition({
              sessionId,
              settlingRunId: 'run-other',
              effect: Effect.sync(() => events.push('other')),
            }),
          )
          teardownQueued.resolve()
          thirdPartyQueued.resolve()
          yield* lendSessionAttachmentTransitionToSettlingRun({
            sessionId,
            runId: 'run-awaited',
            effect: Effect.promise(() => runSettled.promise),
          })
          events.push('holder-durable')
        }),
      }),
    )

    await Promise.all([teardownQueued.promise, thirdPartyQueued.promise, holder])
    await Promise.all([teardown, thirdParty])
    expect(events).toEqual(['holder-bound', 'teardown', 'holder-durable', 'other'])
  })

  it('admits a Run teardown that starts after the loan opened, and not after it closed', async () => {
    const sessionId = 'session-lent-late-teardown'
    const events: string[] = []
    const lentTeardown = Promise.withResolvers<void>()
    const releaseHolder = Promise.withResolvers<void>()
    let lateTeardown: Promise<unknown> | undefined
    const holder = Effect.runPromise(
      withSessionAttachmentTransition({
        sessionId,
        effect: Effect.gen(function* () {
          yield* lendSessionAttachmentTransitionToSettlingRun({
            sessionId,
            runId: 'run-awaited',
            effect: Effect.promise(() =>
              Effect.runPromise(
                withSessionAttachmentTransition({
                  sessionId,
                  settlingRunId: 'run-awaited',
                  effect: Effect.sync(() => events.push('lent-teardown')),
                }),
              ).then(() => lentTeardown.resolve()),
            ),
          })
          lateTeardown = Effect.runPromise(
            withSessionAttachmentTransition({
              sessionId,
              settlingRunId: 'run-awaited',
              effect: Effect.sync(() => events.push('late-teardown')),
            }),
          )
          yield* Effect.promise(() => releaseHolder.promise)
          events.push('holder-done')
        }),
      }),
    )

    await lentTeardown.promise
    await Promise.resolve()
    expect(events).toEqual(['lent-teardown'])
    releaseHolder.resolve()
    await Promise.all([holder, lateTeardown])
    expect(events).toEqual(['lent-teardown', 'holder-done', 'late-teardown'])
  })

  it('does not replace a committed command response with a cleanup failure', async () => {
    const exit = await Effect.runPromiseExit(
      preserveOutcomeAfterAttachmentCleanup({
        effect: Effect.succeed('accepted-command'),
        cleanup: Effect.fail(new Error('cleanup failed')),
        operation: 'command',
        sessionId: 'session-a',
      }),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) expect(exit.value).toBe('accepted-command')
  })

  it('preserves the original command failure when cleanup also defects', async () => {
    const commandFailure = new Error('command failed')
    const exit = await Effect.runPromiseExit(
      preserveOutcomeAfterAttachmentCleanup({
        effect: Effect.fail(commandFailure),
        cleanup: Effect.die(new Error('cleanup defect')),
        operation: 'command',
        sessionId: 'session-a',
      }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause).toMatchObject({ _tag: 'Fail', error: commandFailure })
    }
  })
})
