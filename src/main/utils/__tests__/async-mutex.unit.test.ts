import { describe, expect, it } from 'vitest'
import { AsyncMutex } from '../async-mutex'

describe('AsyncMutex', () => {
  it('serializes concurrent operations', async () => {
    const mutex = new AsyncMutex()
    const order: number[] = []

    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

    // Launch three concurrent tasks — they should run sequentially
    const p1 = mutex.run(async () => {
      order.push(1)
      await delay(30)
      order.push(2)
      return 'a'
    })

    const p2 = mutex.run(async () => {
      order.push(3)
      await delay(10)
      order.push(4)
      return 'b'
    })

    const p3 = mutex.run(async () => {
      order.push(5)
      return 'c'
    })

    const results = await Promise.all([p1, p2, p3])

    expect(results).toEqual(['a', 'b', 'c'])
    // Strict FIFO ordering: 1,2 (p1 finishes), 3,4 (p2 finishes), 5 (p3 finishes)
    expect(order).toEqual([1, 2, 3, 4, 5])
  })

  it('propagates errors without blocking subsequent operations', async () => {
    const mutex = new AsyncMutex()

    const p1 = mutex.run(async () => {
      throw new Error('boom')
    })

    const p2 = mutex.run(async () => 'ok')

    await expect(p1).rejects.toThrow('boom')
    await expect(p2).resolves.toBe('ok')
  })

  it('prevents concurrent read-modify-write data loss', async () => {
    const mutex = new AsyncMutex()
    let counter = 0

    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

    // Simulate 10 concurrent increments — without mutex these would race
    const increments = Array.from({ length: 10 }, () =>
      mutex.run(async () => {
        const current = counter
        await delay(1) // Simulate async read
        counter = current + 1
      }),
    )

    await Promise.all(increments)

    // With mutex all 10 increments should succeed
    expect(counter).toBe(10)
  })
})
