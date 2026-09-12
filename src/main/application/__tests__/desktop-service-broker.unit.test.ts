import { DESKTOP_SERVICE_LIMITS } from '@shared/types/desktop-service'
import { Effect, Fiber } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  brokerHarness,
  browserCommand,
  browserResult,
  exitMessage,
  firstCommand,
} from './desktop-service-broker.test-harness'

const cleanups: Array<() => void> = []
function harness() {
  const instance = brokerHarness()
  cleanups.push(() => instance.broker.close())
  return instance
}
afterEach(() => {
  for (const close of cleanups.splice(0)) close()
  vi.useRealTimers()
})

describe('desktop service broker lease and command lifecycle', () => {
  it('fails explicit browser work when there is no desktop owner', async () => {
    const { broker } = harness()
    expect(exitMessage(await Effect.runPromiseExit(broker.execute(browserCommand)))).toContain(
      'An attached OpenWaggle desktop is required',
    )
  })

  it('requires registration readiness before admitting browser work', async () => {
    const instance = harness()
    await instance.register()
    expect(
      exitMessage(await Effect.runPromiseExit(instance.broker.execute(browserCommand))),
    ).toContain('An attached OpenWaggle desktop is required')
  })

  it('quarantines a competing GUI and rejects commands on a wrong lease', async () => {
    const instance = harness()
    await instance.connect()
    expect(
      await Effect.runPromise(
        instance.broker.handleGuiRequest({ operation: 'register', guiInstanceId: 'gui-two' }),
      ),
    ).toEqual({ operation: 'quarantined', reason: 'previous-owner-unclean' })
    expect(instance.ownerRecord()?.guiInstanceId).toBe('gui-one')
    await expect(instance.poll('wrong-lease')).rejects.toThrow('stale')
  })

  it('delivers a command only once and accepts only the matching completion', async () => {
    const instance = harness()
    const lease = await instance.connect()
    const pending = Effect.runPromiseExit(instance.broker.execute(browserCommand))
    const command = firstCommand((await instance.poll(lease)).commands)
    expect(command.command).toEqual(browserCommand)
    await expect(instance.complete('wrong-lease', command)).rejects.toThrow('stale')
    await expect(
      instance.complete(lease, command, { service: 'browser', operation: 'click', value: null }),
    ).rejects.toThrow('does not match')
    expect(await instance.complete(lease, command)).toEqual({
      operation: 'complete',
      accepted: true,
    })
    expect(await pending).toMatchObject({ _tag: 'Success', value: browserResult })
    expect(await instance.complete(lease, command)).toEqual({
      operation: 'complete',
      accepted: false,
    })
  })

  it('does not dispatch an operation cancelled before the GUI takes it', async () => {
    vi.useFakeTimers()
    const instance = harness()
    const lease = await instance.connect()
    const fiber = Effect.runFork(instance.broker.execute(browserCommand))
    await vi.advanceTimersByTimeAsync(1)
    await Effect.runPromise(Fiber.interrupt(fiber))
    const pendingPoll = instance.poll(lease)
    await vi.advanceTimersByTimeAsync(DESKTOP_SERVICE_LIMITS.pollTimeoutMs)
    expect(await pendingPoll).toMatchObject({ commands: [], cancelledCommandIds: [] })
  })

  it('publishes cancellation for an already dispatched command and rejects its late reply', async () => {
    const instance = harness()
    const lease = await instance.connect()
    const fiber = Effect.runFork(instance.broker.execute(browserCommand))
    const command = firstCommand((await instance.poll(lease)).commands)
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(await instance.poll(lease)).toMatchObject({
      commands: [],
      cancelledCommandIds: [command.commandId],
    })
    expect(await instance.complete(lease, command)).toEqual({
      operation: 'complete',
      accepted: false,
    })
  })

  it.each([false, true])(
    'bounds the deadline of a dispatched=%s command without retrying it',
    async (dispatched) => {
      vi.useFakeTimers()
      const instance = harness()
      const lease = await instance.connect()
      const pending = Effect.runPromiseExit(instance.broker.execute(browserCommand))
      await vi.advanceTimersByTimeAsync(1)
      const command = dispatched ? firstCommand((await instance.poll(lease)).commands) : undefined
      for (let elapsed = 0; elapsed < DESKTOP_SERVICE_LIMITS.commandTimeoutMs; elapsed += 10_000) {
        await vi.advanceTimersByTimeAsync(10_000)
        await instance.ready(lease)
      }
      const message = exitMessage(await pending)
      expect(message).toMatch(dispatched ? /indeterminate|uncertain/i : /before dispatch/)
      if (command) {
        expect(await instance.poll(lease)).toMatchObject({
          commands: [],
          cancelledCommandIds: [command.commandId],
        })
        expect(await instance.complete(lease, command)).toEqual({
          operation: 'complete',
          accepted: false,
        })
      }
    },
  )

  it('makes a dispatched operation indeterminate when its owner disconnects', async () => {
    const instance = harness()
    const lease = await instance.connect()
    const pending = Effect.runPromiseExit(instance.broker.execute(browserCommand))
    const command = firstCommand((await instance.poll(lease)).commands)
    await Effect.runPromise(
      instance.broker.handleGuiRequest({ operation: 'disconnect', leaseId: lease }),
    )
    expect(exitMessage(await pending)).toMatch(/indeterminate|uncertain/i)
    const replacement = await instance.connect()
    expect(replacement).not.toBe(lease)
    expect(await instance.complete(replacement, command)).toEqual({
      operation: 'complete',
      accepted: false,
    })
  })
})
