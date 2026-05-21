import { describe, expect, it } from 'vitest'
import {
  clampSessionTreeFocusIndex,
  findFirstVisibleChildIndex,
  findVisibleParentIndex,
  moveSessionTreeFocus,
} from '../session-tree-visibility'
import {
  FIFTH_ROW_INDEX,
  FIRST_ROW_INDEX,
  node,
  SECOND_ROW_INDEX,
  TREE,
  visibleRows,
} from './session-tree-test-fixtures'

describe('tree-relative focus helpers', () => {
  it('moves from an expanded parent to its first visible child', () => {
    const rows = visibleRows({ nodes: TREE, expandedNodeIds: ['root', 'child-a'] })

    expect(findFirstVisibleChildIndex(rows, FIRST_ROW_INDEX)).toBe(SECOND_ROW_INDEX)
    expect(findFirstVisibleChildIndex(rows, FIFTH_ROW_INDEX)).toBe(FIFTH_ROW_INDEX)
  })

  it('moves from a remapped child to its nearest visible parent', () => {
    const hiddenParentTree = [
      node({ id: 'root', depth: 0, order: 1 }),
      node({ id: 'hidden-tool', parentId: 'root', depth: 1, order: 2 }),
      node({ id: 'visible-child', parentId: 'hidden-tool', depth: 2, order: 3 }),
    ]
    const rows = visibleRows({
      nodes: hiddenParentTree,
      filteredNodes: [hiddenParentTree[0], hiddenParentTree[2]],
      expandedNodeIds: ['root', 'hidden-tool'],
    })

    expect(findVisibleParentIndex(rows, SECOND_ROW_INDEX)).toBe(FIRST_ROW_INDEX)
    expect(findVisibleParentIndex(rows, FIRST_ROW_INDEX)).toBe(FIRST_ROW_INDEX)
  })
})

describe('clampSessionTreeFocusIndex', () => {
  it('clamps focus without advancing it', () => {
    expect(clampSessionTreeFocusIndex(-1, 3)).toBe(0)
    expect(clampSessionTreeFocusIndex(1, 3)).toBe(1)
    expect(clampSessionTreeFocusIndex(3, 3)).toBe(2)
    expect(clampSessionTreeFocusIndex(1, 0)).toBe(0)
  })
})

describe('moveSessionTreeFocus', () => {
  it('keeps keyboard focus inside the visible row bounds', () => {
    expect(moveSessionTreeFocus({ currentIndex: 0, visibleCount: 3, direction: 'previous' })).toBe(
      0,
    )
    expect(moveSessionTreeFocus({ currentIndex: 2, visibleCount: 3, direction: 'next' })).toBe(2)
    expect(moveSessionTreeFocus({ currentIndex: 1, visibleCount: 3, direction: 'previous' })).toBe(
      0,
    )
    expect(moveSessionTreeFocus({ currentIndex: 1, visibleCount: 3, direction: 'next' })).toBe(2)
  })
})
