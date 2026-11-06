import { describe, expect, it } from 'vitest'
import { firstEnabledCommandIndex, nextEnabledCommandIndex } from '../command-palette-navigation'

const items = [{ disabled: true }, {}, { disabled: true }, {}]

describe('command palette navigation', () => {
  it('skips disabled items and wraps in both directions', () => {
    expect(nextEnabledCommandIndex(items, 1, 1)).toBe(3)
    expect(nextEnabledCommandIndex(items, 3, 1)).toBe(1)
    expect(nextEnabledCommandIndex(items, 1, -1)).toBe(3)
    expect(nextEnabledCommandIndex(items, 3, -1)).toBe(1)
  })

  it('stays put when no other item is enabled', () => {
    expect(nextEnabledCommandIndex([{}, { disabled: true }], 0, 1)).toBe(0)
    expect(nextEnabledCommandIndex([], 0, 1)).toBe(0)
  })

  it('starts on the first enabled item', () => {
    expect(firstEnabledCommandIndex(items)).toBe(1)
    expect(firstEnabledCommandIndex([{ disabled: true }])).toBe(0)
    expect(firstEnabledCommandIndex([])).toBe(0)
  })
})
