import { ConversationId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { withConversationLock } from '../conversation-lock'

describe('withConversationLock', () => {
  it('serializes writes to the same conversation', async () => {
    const id = ConversationId('conv-1')
    const order: number[] = []

    const task1 = withConversationLock(id, async () => {
      await delay(50)
      order.push(1)
      return 'a'
    })

    const task2 = withConversationLock(id, async () => {
      order.push(2)
      return 'b'
    })

    const [r1, r2] = await Promise.all([task1, task2])
    expect(r1).toBe('a')
    expect(r2).toBe('b')
    expect(order).toEqual([1, 2]) // task2 waits for task1
  })

  it('allows concurrent writes to different conversations', async () => {
    const id1 = ConversationId('conv-a')
    const id2 = ConversationId('conv-b')
    const order: string[] = []

    const task1 = withConversationLock(id1, async () => {
      await delay(50)
      order.push('a')
    })

    const task2 = withConversationLock(id2, async () => {
      order.push('b')
    })

    await Promise.all([task1, task2])
    // b should complete before a since it has no delay and runs concurrently
    expect(order).toEqual(['b', 'a'])
  })

  it('releases lock even when fn throws', async () => {
    const id = ConversationId('conv-err')

    const failingTask = withConversationLock(id, async () => {
      throw new Error('boom')
    })
    await expect(failingTask).rejects.toThrow('boom')

    // A subsequent task should still run (lock was released)
    const result = await withConversationLock(id, async () => 'recovered')
    expect(result).toBe('recovered')
  })
})

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
