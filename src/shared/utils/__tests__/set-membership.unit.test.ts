import { describe, expect, it } from 'vitest'
import { includesEvery, valuesIn, valuesNotIn } from '../set-membership'

describe('set membership', () => {
  it('keeps the values another list contains, in their original order', () => {
    expect(valuesIn(['c', 'a', 'b', 'a'], ['a', 'c'])).toEqual(['c', 'a', 'a'])
    expect(valuesIn(['a'], [])).toEqual([])
  })

  it('keeps the values another list does not contain, in their original order', () => {
    expect(valuesNotIn(['c', 'a', 'b'], ['a'])).toEqual(['c', 'b'])
    expect(valuesNotIn(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  it('checks that every required value is available', () => {
    expect(includesEvery(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(includesEvery(['a'], ['a', 'b'])).toBe(false)
    expect(includesEvery([], [])).toBe(true)
  })
})
