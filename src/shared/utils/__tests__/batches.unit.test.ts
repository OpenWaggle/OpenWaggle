import { describe, expect, it } from 'vitest'
import { batchesOf, loadInBatches } from '../batches'

describe('batchesOf', () => {
  it('splits values into ordered batches of at most the given size', () => {
    expect(batchesOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(batchesOf([1, 2], 5)).toEqual([[1, 2]])
    expect(batchesOf([], 3)).toEqual([])
  })

  it('refuses a batch size below one', () => {
    expect(() => batchesOf([1], 0)).toThrow('at least one value')
  })
})

describe('loadInBatches', () => {
  it('requests one batch at a time and keeps the results in order', async () => {
    const requested: number[][] = []
    let inFlight = 0
    let mostInFlight = 0
    const results = await loadInBatches([1, 2, 3, 4, 5], 2, async (batch) => {
      requested.push(batch)
      inFlight += 1
      mostInFlight = Math.max(mostInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return batch.map((value) => value * 10)
    })
    expect(results).toEqual([10, 20, 30, 40, 50])
    expect(requested).toEqual([[1, 2], [3, 4], [5]])
    expect(mostInFlight).toBe(1)
  })

  it('requests no further batch once stopped, and returns what it loaded', async () => {
    const requested: number[][] = []
    let stop = false
    const results = await loadInBatches(
      [1, 2, 3],
      1,
      async (batch) => {
        requested.push(batch)
        stop = true
        return batch
      },
      () => stop,
    )
    expect(requested).toEqual([[1]])
    expect(results).toEqual([1])
  })

  it('rejects with the failing batch and requests none after it', async () => {
    const requested: number[][] = []
    await expect(
      loadInBatches([1, 2, 3], 1, async (batch) => {
        requested.push(batch)
        if (batch[0] === 2) throw new Error('batch 2 failed')
        return batch
      }),
    ).rejects.toThrow('batch 2 failed')
    expect(requested).toEqual([[1], [2]])
  })
})
