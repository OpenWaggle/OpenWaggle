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

  it('recovers a stale unclean owner and registers in one step, only when asked', async () => {
    const instance = brokerHarness([], {
      guiInstanceId: 'gui-crashed',
      hostInstanceId: 'host-old',
      state: 'active',
    })
    cleanups.push(() => instance.broker.close())
    expect(
      await Effect.runPromise(
        instance.broker.handleGuiRequest({ operation: 'register', guiInstanceId: 'gui-two' }),
      ),
    ).toEqual({ operation: 'quarantined', reason: 'previous-owner-unclean' })
    expect(instance.ownerRecord()?.guiInstanceId).toBe('gui-crashed')

    const recovered = await Effect.runPromise(
      instance.broker.handleGuiRequest({ operation: 'recoverOwner', guiInstanceId: 'gui-two' }),
    )
    expect(recovered).toMatchObject({ operation: 'register', hostInstanceId: 'host-one' })
    expect(instance.ownerRecord()).toEqual({
      guiInstanceId: 'gui-two',
      hostInstanceId: 'host-one',
      state: 'active',
    })
    if (recovered.operation !== 'register') throw new Error('Expected registration')
    await instance.ready(recovered.leaseId)
  })

  it('never recovers ownership while another desktop lease is fresh', async () => {
    const instance = harness()
    await instance.connect('gui-one')
    expect(
      exitMessage(
        await Effect.runPromiseExit(
          instance.broker.handleGuiRequest({ operation: 'recoverOwner', guiInstanceId: 'gui-two' }),
        ),
      ),
    ).toContain('has not timed out yet')
    expect(instance.ownerRecord()).toMatchObject({ guiInstanceId: 'gui-one', state: 'active' })
  })

  it('recovers once the previous lease has timed out', async () => {
    vi.useFakeTimers()
    const instance = harness()
    await instance.connect('gui-one')
    vi.advanceTimersByTime(DESKTOP_SERVICE_LIMITS.leaseTimeoutMs + 1)
    const recovered = await Effect.runPromise(
      instance.broker.handleGuiRequest({ operation: 'recoverOwner', guiInstanceId: 'gui-two' }),
    )
    expect(recovered.operation).toBe('register')
    expect(instance.ownerRecord()).toMatchObject({ guiInstanceId: 'gui-two', state: 'active' })
  })

  it('releases orphan fences of earlier Hosts under the attestation and keeps live ones', async () => {
    const orphan = {
      token: 'orphan',
      hostInstanceId: 'host-old',
      scope: { kind: 'owner' as const, ownerKey: 'session-one' },
      state: 'active' as const,
    }
    const live = { ...orphan, token: 'live', hostInstanceId: 'host-one' }
    const instance = brokerHarness([orphan, live], {
      guiInstanceId: 'gui-crashed',
      hostInstanceId: 'host-old',
      state: 'active',
    })
    cleanups.push(() => instance.broker.close())
    const recovered = await Effect.runPromise(
      instance.broker.handleGuiRequest({ operation: 'recoverOwner', guiInstanceId: 'gui-two' }),
    )
    if (recovered.operation !== 'register') throw new Error('Expected registration')
    expect(recovered.fences).toEqual(
      expect.arrayContaining([
        { ...orphan, state: 'released' },
        { ...live, state: 'active' },
      ]),
    )
    await Effect.runPromise(
      instance.broker.handleGuiRequest({
        operation: 'acknowledgeReleased',
        leaseId: recovered.leaseId,
        token: 'orphan',
        hostInstanceId: 'host-old',
      }),
    )
    expect(instance.records.has('orphan')).toBe(false)
  })

  it('treats recovery with no stale owner as an ordinary registration', async () => {
    const instance = harness()
    const recovered = await Effect.runPromise(
      instance.broker.handleGuiRequest({ operation: 'recoverOwner', guiInstanceId: 'gui-one' }),
    )
    expect(recovered.operation).toBe('register')
    expect(instance.ownerRecord()).toMatchObject({ guiInstanceId: 'gui-one', state: 'active' })
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
