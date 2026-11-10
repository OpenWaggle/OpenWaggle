import { describe, expect, it } from 'vitest'
import { batchesOf } from '../batches'

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
