import { expect, it, vi } from 'vitest'
import type { HiveHostEvent } from '../session-hive-events'
import { subscribeSessionHiveUpdates } from '../session-hive-events'

it('batches Host state/list changes, ignores transport tokens and duplicate cursors', async () => {
  const invalidate = vi.fn()
  const resync = vi.fn()
  const unsubscribe = vi.fn()
  let receive: (event: HiveHostEvent) => void = vi.fn()
  const dispose = subscribeSessionHiveUpdates(
    {
      onSessionHostEvent: (callback) => {
        receive = callback
        return unsubscribe
      },
    },
    { invalidate, resync },
  )
  const emit = (sequence: number, kind: string) =>
    receive({
      cursor: { hostInstanceId: 'host-a', sequence },
      payload: { kind },
    })
  emit(1, 'session-transport')
  emit(2, 'session-list-changed')
  emit(3, 'session-state-changed')
  emit(3, 'session-state-changed')
  await Promise.resolve()
  expect(invalidate).toHaveBeenCalledTimes(1)
  emit(2, 'session-list-changed')
  emit(4, 'session-transport')
  await Promise.resolve()
  expect(invalidate).toHaveBeenCalledTimes(1)
  emit(5, 'session-list-changed')
  dispose()
  await Promise.resolve()
  expect(invalidate).toHaveBeenCalledTimes(1)
  expect(unsubscribe).toHaveBeenCalledOnce()
})

it('resets pages on Host resync and accepts the new Host sequence', async () => {
  const invalidate = vi.fn()
  const resync = vi.fn()
  const unsubscribeResync = vi.fn()
  let receive: (event: HiveHostEvent) => void = vi.fn()
  let receiveResync: () => void = vi.fn()
  const dispose = subscribeSessionHiveUpdates(
    {
      onSessionHostEvent: (callback) => {
        receive = callback
        return vi.fn()
      },
      onSessionHostResyncRequired: (callback) => {
        receiveResync = callback
        return unsubscribeResync
      },
    },
    { invalidate, resync },
  )
  receive({
    cursor: { hostInstanceId: 'old', sequence: 100 },
    payload: { kind: 'session-list-changed' },
  })
  receiveResync()
  await Promise.resolve()
  expect(resync).toHaveBeenCalledOnce()
  expect(invalidate).not.toHaveBeenCalled()
  receive({
    cursor: { hostInstanceId: 'new', sequence: 1 },
    payload: { kind: 'session-state-changed' },
  })
  await Promise.resolve()
  expect(invalidate).toHaveBeenCalledOnce()
  dispose()
  expect(unsubscribeResync).toHaveBeenCalledOnce()
})

it('does not subscribe to fabricated missing-method fallbacks', () => {
  const fabricatedMethod = vi.fn()
  const source = new Proxy({}, { get: () => fabricatedMethod })
  const dispose = subscribeSessionHiveUpdates(source, { invalidate: vi.fn(), resync: vi.fn() })
  expect(fabricatedMethod).not.toHaveBeenCalled()
  dispose()
})
