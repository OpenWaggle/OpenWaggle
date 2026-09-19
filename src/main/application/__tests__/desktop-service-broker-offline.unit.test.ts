import type { DesktopOwnerRecord } from '@shared/types/desktop-owner'
import type { DesktopFenceRecord } from '@shared/types/desktop-service'
import { Effect, Fiber } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeFence, brokerHarness, browserCommand } from './desktop-service-broker.test-harness'
import {
  acknowledgeReleasedFence,
  waitForReleasedFence,
} from './desktop-service-broker-release.test-harness'

const cleanups: Array<() => void> = []
function harness(
  initial: readonly DesktopFenceRecord[] = [],
  owner: DesktopOwnerRecord | null = null,
) {
  const instance = brokerHarness(initial, owner)
  cleanups.push(() => instance.broker.close())
  return instance
}
afterEach(() => {
  for (const close of cleanups.splice(0)) close()
})
const scope = { kind: 'owner' as const, ownerKey: 'session-one' }
const cleanup = {
  service: 'browser' as const,
  operation: 'deleteOwner' as const,
  ownerKey: 'session-one',
}
const closedOwner: DesktopOwnerRecord = {
  guiInstanceId: 'gui-old',
  hostInstanceId: 'host-old',
  state: 'closed',
}

describe('desktop broker native-free cleanup proof', () => {
  it.each([{ owner: null }, { owner: closedOwner }])(
    'permits exactly fenced cleanup after native-free proof %#',
    async ({ owner }) => {
      const instance = harness([], owner)
      const result = await Effect.runPromise(
        instance.broker.runWithMutationFence(scope, instance.broker.execute(cleanup)),
      )
      expect(result).toEqual({ service: 'browser', operation: 'deleteOwner', value: null })
      expect(instance.offlineCommands).toEqual([cleanup])
      expect(instance.records.size).toBe(0)
      expect(instance.writes.map((write) => write.split(':')[0])).toEqual([
        'insert',
        'released',
        'removed',
      ])
    },
  )

  it('does not infer native-free proof from the absence of a transport lease', async () => {
    const owner: DesktopOwnerRecord = { ...closedOwner, state: 'active' }
    const instance = harness([], owner)
    const mutate = vi.fn()
    await expect(
      Effect.runPromise(instance.broker.runWithMutationFence(scope, Effect.sync(mutate))),
    ).rejects.toThrow('attached OpenWaggle desktop')
    expect(mutate).not.toHaveBeenCalled()
    expect(instance.offlineCommands).toEqual([])
    expect(instance.records.size).toBe(0)
    expect(instance.ownerRecord()).toEqual(owner)
  })

  it('rejects cleanup outside a live exact Host fence even with no native owner', async () => {
    const instance = harness()
    await expect(Effect.runPromise(instance.broker.execute(cleanup))).rejects.toThrow(
      'attached OpenWaggle desktop',
    )
    expect(instance.offlineCommands).toEqual([])
  })

  it('does not let another scope use the native-free cleanup allowance', async () => {
    const instance = harness()
    await expect(
      Effect.runPromise(
        instance.broker.runWithMutationFence(
          scope,
          instance.broker.execute({ ...cleanup, ownerKey: 'session-other' }),
        ),
      ),
    ).rejects.toThrow('attached OpenWaggle desktop')
    expect(instance.offlineCommands).toEqual([])
    expect(instance.records.size).toBe(0)
  })

  it('does not adopt an old Host journal fence as an active cleanup capability', async () => {
    const record = { ...activeFence(), hostInstanceId: 'host-old' }
    const instance = harness([record])
    await expect(Effect.runPromise(instance.broker.execute(cleanup))).rejects.toThrow(
      'attached OpenWaggle desktop',
    )
    expect([...instance.records.values()]).toEqual([record])
    expect(instance.offlineCommands).toEqual([])
  })

  it('requires a GUI attaching during offline work to reconcile the existing fence', async () => {
    const instance = harness()
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const pending = Effect.runPromise(
      instance.broker.runWithMutationFence(
        scope,
        Effect.promise(() => {
          started.resolve()
          return finish.promise
        }),
      ),
    )
    await started.promise
    const registration = await instance.register()
    expect(registration.fences).toHaveLength(1)
    await expect(instance.ready(registration.leaseId, [])).rejects.toThrow('fences changed')
    await instance.ready(
      registration.leaseId,
      registration.fences.map((record) => record.token),
    )
    await expect(Effect.runPromise(instance.broker.execute(browserCommand))).rejects.toThrow(
      'active desktop mutation fence',
    )
    finish.resolve()
    const released = await waitForReleasedFence(instance)
    await acknowledgeReleasedFence(instance, registration.leaseId, released)
    await pending
    expect(instance.records.size).toBe(0)
  })

  it('rejects a forged cleanup receipt without replacing uncertain native ownership', async () => {
    const owner: DesktopOwnerRecord = { ...closedOwner, state: 'active' }
    const instance = harness([], owner)
    await expect(
      Effect.runPromise(
        instance.broker.handleGuiRequest({
          operation: 'markClosed',
          guiInstanceId: 'gui-new',
          hostInstanceId: 'host-one',
        }),
      ),
    ).rejects.toThrow('receipt does not match')
    expect(instance.ownerRecord()).toEqual(owner)
  })

  it('keeps failed durable release active instead of admitting subsequent work', async () => {
    const instance = harness()
    const mutate = vi.fn()
    vi.spyOn(instance.repository, 'markReleased').mockImplementation(() =>
      Effect.fail(new Error('journal write failed')),
    )
    await expect(
      Effect.runPromise(instance.broker.runWithMutationFence(scope, Effect.sync(mutate))),
    ).rejects.toThrow('journal write failed')
    expect(mutate).toHaveBeenCalledOnce()
    expect([...instance.records.values()]).toMatchObject([{ state: 'active' }])
    await expect(
      Effect.runPromise(instance.broker.runWithMutationFence(scope, Effect.void)),
    ).rejects.toThrow('already owns this scope')
  })

  it('does not run a Host mutation when durable fence insertion fails', async () => {
    const instance = harness()
    const mutate = vi.fn()
    vi.spyOn(instance.repository, 'insert').mockImplementation(() =>
      Effect.fail(new Error('journal write failed')),
    )
    await expect(
      Effect.runPromise(instance.broker.runWithMutationFence(scope, Effect.sync(mutate))),
    ).rejects.toThrow('journal write failed')
    expect(mutate).not.toHaveBeenCalled()
    expect(instance.records.size).toBe(0)
  })

  it('releases an offline fence when cancellation races its durable insertion', async () => {
    const instance = harness()
    const inserting = Promise.withResolvers<void>()
    const allowInsert = Promise.withResolvers<void>()
    const inserted = Promise.withResolvers<void>()
    const insert = instance.repository.insert
    vi.spyOn(instance.repository, 'insert').mockImplementation((record) =>
      Effect.promise(() => {
        inserting.resolve()
        return allowInsert.promise
      }).pipe(
        Effect.zipRight(insert(record)),
        Effect.tap(() => Effect.sync(() => inserted.resolve())),
      ),
    )
    const mutate = vi.fn()
    const fiber = Effect.runFork(instance.broker.runWithMutationFence(scope, Effect.sync(mutate)))
    await inserting.promise
    let interrupted = false
    const interruption = Effect.runPromise(Fiber.interrupt(fiber)).then(() => {
      interrupted = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(interrupted).toBe(false)
    allowInsert.resolve()
    await interruption
    await inserted.promise
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(mutate).not.toHaveBeenCalled()
    expect(instance.records.size).toBe(0)
    expect(instance.writes.map((write) => write.split(':')[0])).toEqual([
      'insert',
      'released',
      'removed',
    ])
  })
})
