import { Cause, Effect, Exit, Option } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isIndeterminateDesktopOperation } from '../desktop-service-errors'
import { DESKTOP_FENCE_RELEASE_TIMEOUT_MS } from '../desktop-service-fences'
import { brokerHarness, firstCommand } from './desktop-service-broker.test-harness'
import {
  acknowledgeReleasedFence,
  waitForReleasedFence,
} from './desktop-service-broker-release.test-harness'

const scope = { kind: 'owner' as const, ownerKey: 'session-one' }
const cleanups: Array<() => void> = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const close of cleanups.splice(0)) close()
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function releasedMutation(signal?: AbortSignal) {
  const instance = brokerHarness()
  cleanups.push(() => instance.broker.close())
  const lease = await instance.connect()
  const mutate = vi.fn(() => 'done')
  let settled = false
  const pending = Effect.runPromiseExit(
    instance.broker.runWithMutationFence(scope, Effect.sync(mutate)),
    signal === undefined ? undefined : { signal },
  ).then((outcome) => {
    settled = true
    return outcome
  })
  const first = await instance.poll(lease)
  const command = firstCommand(
    first.commands.length > 0 ? first.commands : (await instance.poll(lease)).commands,
  )
  await instance.complete(lease, command, { service: 'fence', operation: 'acquire', value: null })
  const record = await waitForReleasedFence(instance)
  return { instance, lease, mutate, pending, record, isSettled: () => settled }
}

function expectIndeterminate(outcome: Exit.Exit<unknown, unknown>) {
  if (Exit.isSuccess(outcome)) throw new Error('Expected an indeterminate mutation result.')
  expect(
    isIndeterminateDesktopOperation(Option.getOrUndefined(Cause.failureOption(outcome.cause))),
  ).toBe(true)
}

describe('desktop mutation release acknowledgement', () => {
  it('does not report mutation success until the exact GUI release is acknowledged', async () => {
    const { instance, lease, mutate, pending, record, isSettled } = await releasedMutation()
    expect(mutate).toHaveBeenCalledOnce()
    expect(isSettled()).toBe(false)
    expect(instance.records.get(record.token)).toEqual(record)
    await acknowledgeReleasedFence(instance, lease, record)
    await expect(pending).resolves.toMatchObject({ _tag: 'Success', value: 'done' })
    expect(instance.records.size).toBe(0)
  })

  it('reports broker closure after the mutation as indeterminate and retains its release record', async () => {
    const { instance, pending, record } = await releasedMutation()
    instance.broker.close()
    expectIndeterminate(await pending)
    expect(instance.records.get(record.token)).toEqual(record)
    expect(instance.ownerRecord()?.state).toBe('active')
  })

  it('rejects the wrong lease and Host without acknowledging the pending mutation', async () => {
    const { instance, lease, pending, record, isSettled } = await releasedMutation()
    for (const request of [
      { leaseId: 'wrong-lease', token: record.token, hostInstanceId: record.hostInstanceId },
      { leaseId: lease, token: record.token, hostInstanceId: 'wrong-host' },
    ]) {
      await expect(
        Effect.runPromise(
          instance.broker.handleGuiRequest({ operation: 'acknowledgeReleased', ...request }),
        ),
      ).rejects.toThrow()
      expect(isSettled()).toBe(false)
      expect(instance.records.get(record.token)).toEqual(record)
    }
    await acknowledgeReleasedFence(instance, lease, record)
    await expect(pending).resolves.toMatchObject({ _tag: 'Success' })
  })

  it('accepts an unknown token as an idempotent no-op without completing another pending mutation', async () => {
    const { instance, lease, pending, record, isSettled } = await releasedMutation()
    await expect(
      acknowledgeReleasedFence(instance, lease, { ...record, token: 'unknown-token' }),
    ).resolves.toEqual({ operation: 'acknowledgeReleased', accepted: true })
    await vi.advanceTimersByTimeAsync(100)
    expect(isSettled()).toBe(false)
    expect(instance.records.get(record.token)).toEqual(record)
    expect(instance.writes).not.toContain('removed:unknown-token')
    await acknowledgeReleasedFence(instance, lease, record)
    await expect(pending).resolves.toMatchObject({ _tag: 'Success' })
    expect(instance.records.size).toBe(0)
  })

  it('bounds a failed release receipt without dropping the journal or turning a late receipt into success', async () => {
    const { instance, lease, pending, record, isSettled } = await releasedMutation()
    const remove = vi
      .spyOn(instance.repository, 'removeReleased')
      .mockImplementation(() => Effect.fail(new Error('release receipt storage failed')))
    await expect(acknowledgeReleasedFence(instance, lease, record)).rejects.toThrow(
      'storage failed',
    )
    expect(isSettled()).toBe(false)
    expect(instance.records.get(record.token)).toEqual(record)
    await vi.advanceTimersByTimeAsync(DESKTOP_FENCE_RELEASE_TIMEOUT_MS)
    expectIndeterminate(await pending)
    expect(instance.records.get(record.token)).toEqual(record)
    remove.mockRestore()
    await acknowledgeReleasedFence(instance, lease, record)
    expect(instance.records.size).toBe(0)
    expectIndeterminate(await pending)
  })

  it('retains cleanup through caller cancellation until the exact release is acknowledged', async () => {
    const controller = new AbortController()
    const { instance, lease, pending, record, isSettled } = await releasedMutation(
      controller.signal,
    )
    controller.abort()
    await vi.advanceTimersByTimeAsync(100)
    expect(isSettled()).toBe(false)
    expect(instance.records.get(record.token)).toEqual(record)
    await acknowledgeReleasedFence(instance, lease, record)
    const outcome = await pending
    expect(Exit.isInterrupted(outcome)).toBe(true)
    expect(instance.records.size).toBe(0)
  })

  it('keeps a disconnected mutation indeterminate while the same GUI later reconciles its exact release', async () => {
    const { instance, lease, mutate, pending, record } = await releasedMutation()
    await Effect.runPromise(
      instance.broker.handleGuiRequest({ operation: 'disconnect', leaseId: lease }),
    )
    expectIndeterminate(await pending)
    expect(instance.records.get(record.token)).toEqual(record)
    const replacement = await instance.register()
    expect(replacement.leaseId).not.toBe(lease)
    expect(replacement.fences).toEqual([record])
    await instance.ready(replacement.leaseId, [])
    await expect(acknowledgeReleasedFence(instance, lease, record)).rejects.toThrow('stale')
    await acknowledgeReleasedFence(instance, replacement.leaseId, record)
    expect(instance.records.size).toBe(0)
    expectIndeterminate(await pending)
    expect(mutate).toHaveBeenCalledOnce()
  })
})
