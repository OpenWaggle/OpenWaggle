import { SessionId } from '@shared/types/brand'
import { DESKTOP_SERVICE_LIMITS, type DesktopFenceRecord } from '@shared/types/desktop-service'
import { Effect, Fiber } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activeFence,
  brokerHarness,
  browserCommand,
  firstCommand,
} from './desktop-service-broker.test-harness'
import {
  acknowledgeReleasedFence,
  waitForReleasedFence,
} from './desktop-service-broker-release.test-harness'

const cleanups: Array<() => void> = []
function harness(initial: readonly DesktopFenceRecord[] = []) {
  const instance = brokerHarness(initial)
  cleanups.push(() => instance.broker.close())
  return instance
}
afterEach(() => {
  for (const close of cleanups.splice(0)) close()
  vi.useRealTimers()
})
const scope = { kind: 'owner' as const, ownerKey: 'session-one' }
const fenceResult = { service: 'fence' as const, operation: 'acquire' as const, value: null }
async function pollFence(instance: ReturnType<typeof harness>, lease: string) {
  const first = await instance.poll(lease)
  if (first.commands.length > 0) return first
  // A durable journal change wakes the GUI before the acquire command is enqueued.
  expect(first.fences.some((record) => record.state === 'active')).toBe(true)
  return instance.poll(lease)
}

describe('desktop service broker durable mutation fences', () => {
  it('persists the fence before dispatch and waits for GUI acquisition before mutating', async () => {
    const instance = harness()
    const lease = await instance.connect()
    const mutate = vi.fn(() => 'done')
    const pending = Effect.runPromiseExit(
      instance.broker.runWithMutationFence(scope, Effect.sync(mutate)),
    )
    const command = firstCommand((await pollFence(instance, lease)).commands)
    expect(command.command).toMatchObject({
      service: 'fence',
      operation: 'acquire',
      record: { scope, state: 'active' },
    })
    expect([...instance.records.values()]).toHaveLength(1)
    expect(mutate).not.toHaveBeenCalled()
    await instance.complete(lease, command, fenceResult)
    await acknowledgeReleasedFence(instance, lease, await waitForReleasedFence(instance))
    expect(await pending).toMatchObject({ _tag: 'Success', value: 'done' })
    expect(mutate).toHaveBeenCalledOnce()
    expect(instance.records.size).toBe(0)
  })

  it('releases only the persisted token if cancelled before mutation admission', async () => {
    const instance = harness()
    const lease = await instance.connect()
    const mutate = vi.fn()
    const fiber = Effect.runFork(instance.broker.runWithMutationFence(scope, Effect.sync(mutate)))
    const command = firstCommand((await pollFence(instance, lease)).commands)
    const interruption = Effect.runPromise(Fiber.interrupt(fiber))
    const released = await waitForReleasedFence(instance)
    expect(mutate).not.toHaveBeenCalled()
    expect(await instance.complete(lease, command, fenceResult)).toEqual({
      operation: 'complete',
      accepted: false,
    })
    await acknowledgeReleasedFence(instance, lease, released)
    await interruption
    expect(instance.records.size).toBe(0)
  })

  it('keeps an acquired fence active through a disconnect until the Host operation finishes', async () => {
    const instance = harness()
    const lease = await instance.connect()
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const operation = Effect.promise(() => {
      started.resolve()
      return finish.promise
    })
    const pending = Effect.runPromiseExit(instance.broker.runWithMutationFence(scope, operation))
    const command = firstCommand((await pollFence(instance, lease)).commands)
    await instance.complete(lease, command, fenceResult)
    await started.promise
    await Effect.runPromise(
      instance.broker.handleGuiRequest({ operation: 'disconnect', leaseId: lease }),
    )
    expect([...instance.records.values()]).toMatchObject([{ state: 'active' }])
    finish.resolve()
    expect(await pending).toMatchObject({ _tag: 'Failure' })
    expect([...instance.records.values()]).toMatchObject([{ state: 'released' }])
  })

  it('does not expire an active durable fence when the desktop lease expires', async () => {
    vi.useFakeTimers()
    const instance = harness([activeFence()])
    const lease = await instance.connect()
    await vi.advanceTimersByTimeAsync(DESKTOP_SERVICE_LIMITS.leaseTimeoutMs + 1)
    await expect(instance.poll(lease)).rejects.toThrow('An attached OpenWaggle desktop is required')
    expect([...instance.records.values()]).toEqual([activeFence()])
    const replacement = await instance.register()
    expect(replacement.fences).toEqual([activeFence()])
  })

  it.each([{ tokens: [] }, { tokens: ['unknown'] }, { tokens: ['fence-old', 'fence-old'] }])(
    'refuses incomplete, extra, or duplicate reconciliation tokens %#',
    async ({ tokens }) => {
      const instance = harness([activeFence()])
      const registration = await instance.register()
      await expect(instance.ready(registration.leaseId, tokens)).rejects.toThrow('fences changed')
      await expect(
        Effect.runPromise(
          instance.broker.execute({
            ...browserCommand,
            scope: { ...browserCommand.scope, sessionId: SessionId('unrelated-session') },
          }),
        ),
      ).rejects.toThrow('An attached OpenWaggle desktop is required')
    },
  )

  it('admits a reconciled desktop but blocks browser work touching an active fence', async () => {
    const instance = harness([activeFence()])
    await instance.connect()
    await expect(Effect.runPromise(instance.broker.execute(browserCommand))).rejects.toThrow(
      'active desktop mutation fence',
    )
  })

  it('does not acknowledge release for the wrong Host or an active fence', async () => {
    const instance = harness([activeFence()])
    const lease = await instance.connect()
    for (const hostInstanceId of ['host-wrong', 'host-one']) {
      await expect(
        Effect.runPromise(
          instance.broker.handleGuiRequest({
            operation: 'acknowledgeReleased',
            leaseId: lease,
            token: 'fence-old',
            hostInstanceId,
          }),
        ),
      ).rejects.toThrow('not released')
    }
    expect([...instance.records.values()]).toEqual([activeFence()])
  })

  it('serializes overlapping acquisition before either Host mutation is admitted', async () => {
    const instance = harness()
    const lease = await instance.connect()
    const mutate = vi.fn()
    const first = Effect.runPromiseExit(
      instance.broker.runWithMutationFence(scope, Effect.sync(mutate)),
    )
    const second = Effect.runPromiseExit(
      instance.broker.runWithMutationFence(scope, Effect.sync(mutate)),
    )
    const response = await pollFence(instance, lease)
    expect(response.commands).toHaveLength(1)
    expect([...instance.records.values()]).toHaveLength(1)
    const command = firstCommand(response.commands)
    await instance.complete(lease, command, fenceResult)
    await acknowledgeReleasedFence(instance, lease, await waitForReleasedFence(instance))
    const outcomes = await Promise.all([first, second])
    expect(outcomes.filter((outcome) => outcome._tag === 'Success')).toHaveLength(1)
    expect(mutate).toHaveBeenCalledOnce()
  })
})
