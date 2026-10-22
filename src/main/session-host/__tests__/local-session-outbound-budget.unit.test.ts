import { describe, expect, it } from 'vitest'
import {
  MAX_LOCAL_SESSION_FRAME_BYTES,
  MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES,
} from '../local-session-framing'
import {
  LocalSessionOutboundByteBudget,
  LocalSessionOutboundCapacityError,
} from '../local-session-outbound-budget'

/** Room for one encoding plus a few hundred retained bytes, so one small unread frame fills it. */
const CAPACITY = MAX_LOCAL_SESSION_LOGICAL_MESSAGE_BYTES + MAX_LOCAL_SESSION_FRAME_BYTES + 256
const UNREAD_FRAME = { text: 'x'.repeat(512) }

function fullBudget(capacityWaitMs: number) {
  const budget = new LocalSessionOutboundByteBudget(CAPACITY, { capacityWaitMs })
  return budget.encode(UNREAD_FRAME, new AbortController().signal).then((held) => ({
    budget,
    held,
  }))
}

describe('LocalSessionOutboundByteBudget', () => {
  it('encodes a frame once an unread frame releases the room it held', async () => {
    const { budget, held } = await fullBudget(10_000)
    let encoded = false
    const waiting = budget.encode({ ok: true }, new AbortController().signal).then((lease) => {
      encoded = true
      return lease
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(encoded).toBe(false)

    held.release()
    const lease = await waiting
    expect(JSON.parse(lease.payload.toString('utf8'))).toEqual({ ok: true })
    lease.release()
    expect(budget.pendingBytes).toBe(0)
    expect(budget.peakBytes).toBeLessThanOrEqual(budget.maxBytes)
  })

  it('fails with a capacity error when the room stays held for the whole wait', async () => {
    const { budget, held } = await fullBudget(20)
    await expect(budget.encode({ ok: true }, new AbortController().signal)).rejects.toBeInstanceOf(
      LocalSessionOutboundCapacityError,
    )
    held.release()
    expect(budget.pendingBytes).toBe(0)
  })

  it('stops waiting when its connection goes away', async () => {
    const { budget, held } = await fullBudget(10_000)
    const connection = new AbortController()
    const waiting = budget.encode({ ok: true }, connection.signal)
    connection.abort()
    await expect(waiting).rejects.toThrow('Local Session outbound encoding was aborted.')
    held.release()
    expect(budget.pendingBytes).toBe(0)
  })
})
