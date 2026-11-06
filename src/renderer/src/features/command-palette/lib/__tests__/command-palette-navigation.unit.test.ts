import { describe, expect, it } from 'vitest'
import { groupCommandPaletteItems } from '../command-palette-entries'
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

describe('groupCommandPaletteItems', () => {
  const item = (id: string, section?: string) => ({
    id,
    label: id,
    icon: null,
    action: () => undefined,
    ...(section ? { section } : {}),
  })

  it('groups consecutive items by section and keeps their list indices', () => {
    const groups = groupCommandPaletteItems([
      item('loose'),
      item('a', 'Project actions'),
      item('b', 'Project actions'),
      item('c', 'View'),
      item('d', 'configure'),
    ])

    expect(
      groups.map((group) => ({
        label: group.label,
        indices: group.entries.map((entry) => entry.index),
      })),
    ).toEqual([
      { label: undefined, indices: [0] },
      { label: 'Project actions', indices: [1, 2] },
      { label: 'View', indices: [3] },
      // The slash menu's configure section has no visible header.
      { label: undefined, indices: [4] },
    ])
    // Keys become DOM id fragments, so they must not carry the section's spaces.
    for (const group of groups) expect(group.key).not.toMatch(/\s/)
  })

  it('keeps a section group key stable when filtering removes earlier items', () => {
    const all = groupCommandPaletteItems([
      item('a', 'Create'),
      item('b', 'View'),
      item('c', 'View'),
    ])
    const filtered = groupCommandPaletteItems([item('c', 'View')])

    expect(filtered[0]?.key).toBe(all[1]?.key)
  })
})
