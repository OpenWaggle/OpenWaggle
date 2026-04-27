import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { withSessionLock } from '../session-lock'

describe('withSessionLock', () => {
  it('serializes writes to the same session', async () => {
    const id = SessionId('session-1')
    const order: number[] = []

    const task1 = withSessionLock(id, async () => {
      await delay(50)
      order.push(1)
      return 'a'
    })

    const task2 = withSessionLock(id, async () => {
      order.push(2)
      return 'b'
    })

    const [r1, r2] = await Promise.all([task1, task2])
    expect(r1).toBe('a')
    expect(r2).toBe('b')
    expect(order).toEqual([1, 2])
  })

  it('allows concurrent writes to different sessions', async () => {
    const id1 = SessionId('session-a')
    const id2 = SessionId('session-b')
    const order: string[] = []

    const task1 = withSessionLock(id1, async () => {
      await delay(50)
      order.push('a')
    })

    const task2 = withSessionLock(id2, async () => {
      order.push('b')
    })

    await Promise.all([task1, task2])
    expect(order).toEqual(['b', 'a'])
  })

  it('releases lock even when fn throws', async () => {
    const id = SessionId('session-err')

    const failingTask = withSessionLock(id, async () => {
      throw new Error('boom')
    })
    await expect(failingTask).rejects.toThrow('boom')

    const result = await withSessionLock(id, async () => 'recovered')
    expect(result).toBe('recovered')
  })
})

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
