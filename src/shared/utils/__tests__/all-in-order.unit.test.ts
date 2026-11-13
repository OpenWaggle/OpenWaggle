import { describe, expect, it } from 'vitest'
import { allInOrder, mapInOrder } from '../all-in-order'

function later<T>(milliseconds: number, settle: () => T) {
  return new Promise<T>((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(settle())
      } catch (error) {
        reject(error)
      }
    }, milliseconds)
  })
}

describe('allInOrder', () => {
  it('resolves every value in argument order', async () => {
    const [first, second, third] = await allInOrder([later(5, () => 'a'), 2, Promise.resolve(true)])
    expect([first, second, third]).toEqual(['a', 2, true])
  })

  it('rejects with the first rejection in argument order, not in time', async () => {
    const slowFailure = later(10, () => {
      throw new Error('first')
    })
    const fastFailure = later(0, () => {
      throw new Error('second')
    })
    await expect(allInOrder([slowFailure, fastFailure])).rejects.toThrow('first')
  })

  it('waits for the other values before rejecting', async () => {
    let finished = false
    const slow = later(10, () => {
      finished = true
    })
    await expect(allInOrder([Promise.reject(new Error('failed')), slow])).rejects.toThrow('failed')
    expect(finished).toBe(true)
  })
})

describe('mapInOrder', () => {
  // The concurrency cap is covered through the export bundle's hashing test.
  it('rejects with the first failure in argument order and starts nothing after a failure', async () => {
    const started: number[] = []
    const result = mapInOrder([0, 1, 2, 3, 4, 5], 2, (index) => {
      started.push(index)
      return later(index === 0 ? 20 : 0, () => {
        if (index === 0) throw new Error('first')
        if (index === 1) throw new Error('second')
        return index
      })
    })

    await expect(result).rejects.toThrow('first')
    expect(started).toEqual([0, 1])
  })
})
