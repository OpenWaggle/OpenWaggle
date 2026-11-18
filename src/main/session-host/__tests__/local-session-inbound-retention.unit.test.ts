import { describe, expect, it } from 'vitest'
import { encodeLocalSessionFrame } from '../local-session-framing'
import {
  LocalSessionInboundCapacityError,
  LocalSessionInboundRetention,
} from '../local-session-inbound-retention'
import { LocalSessionInboundByteBudget } from '../local-session-resource-policy'

describe('LocalSessionInboundRetention', () => {
  it('leases decoded frame bytes until asynchronous dispatch releases the batch', () => {
    const frame = encodeLocalSessionFrame({ kind: 'command', payload: 'held during dispatch' })
    const budget = new LocalSessionInboundByteBudget(frame.byteLength)
    const retention = new LocalSessionInboundRetention(budget)

    const batch = retention.push(frame)

    expect(batch.values).toEqual([{ kind: 'command', payload: 'held during dispatch' }])
    expect(budget.pendingBytes).toBe(frame.byteLength)
    batch.release()
    expect(budget.pendingBytes).toBe(0)
  })

  it('keeps the global budget unavailable to another connection while dispatch is pending', () => {
    const frame = encodeLocalSessionFrame({ payload: 'shared capacity' })
    const budget = new LocalSessionInboundByteBudget(frame.byteLength)
    const first = new LocalSessionInboundRetention(budget)
    const second = new LocalSessionInboundRetention(budget)

    const batch = first.push(frame)
    expect(() => second.push(frame)).toThrow(LocalSessionInboundCapacityError)

    batch.release()
    const secondBatch = second.push(frame)
    expect(secondBatch.values).toEqual([{ payload: 'shared capacity' }])
    secondBatch.release()
  })

  it('keeps decoded batches leased when connection close releases an incomplete frame', () => {
    const firstFrame = encodeLocalSessionFrame({ payload: 'first' })
    const incompleteFrame = Buffer.alloc(8)
    incompleteFrame.writeUInt32BE(32)
    const budget = new LocalSessionInboundByteBudget(
      firstFrame.byteLength + incompleteFrame.byteLength,
    )
    const retention = new LocalSessionInboundRetention(budget)

    const firstBatch = retention.push(firstFrame)
    const incompleteBatch = retention.push(incompleteFrame)
    expect(incompleteBatch.values).toEqual([])
    expect(budget.pendingBytes).toBe(firstFrame.byteLength + incompleteFrame.byteLength)

    retention.releasePendingFrame()
    expect(budget.pendingBytes).toBe(firstFrame.byteLength)
    firstBatch.release()
    incompleteBatch.release()
    expect(budget.pendingBytes).toBe(0)
  })
})
