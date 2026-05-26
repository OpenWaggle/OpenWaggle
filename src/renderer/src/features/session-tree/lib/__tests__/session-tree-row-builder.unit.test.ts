import { SessionNodeId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { getVisibleSessionTreeNodes } from '../session-tree-visibility'
import {
  BRANCH_TREE,
  FIRST_ROW_INDEX,
  LINEAR_TREE,
  node,
  nodeAt,
  rowDepths,
  rowIds,
  SECOND_ROW_INDEX,
  TREE,
  visibleRows,
} from './session-tree-test-fixtures'

describe('getVisibleSessionTreeRows', () => {
  it('hides descendants of collapsed ancestors while preserving siblings', () => {
    const rows = visibleRows({ nodes: TREE, expandedNodeIds: ['root'] })

    expect(rowIds(rows)).toEqual(['root', 'child-a', 'child-b', 'sibling-root'])
  })

  it('shows nested descendants when every ancestor is expanded', () => {
    const rows = visibleRows({ nodes: TREE, expandedNodeIds: ['root', 'child-a'] })

    expect(rowIds(rows)).toEqual(['root', 'child-a', 'grandchild-a', 'child-b', 'sibling-root'])
  })

  it('keeps single-child chains on the same visual rail', () => {
    const rows = visibleRows({
      nodes: LINEAR_TREE,
      expandedNodeIds: ['linear-root', 'linear-child'],
    })

    expect(rowDepths(rows)).toEqual([0, 0, 0])
  })

  it('indents only when the visible tree actually branches', () => {
    const rows = visibleRows({
      nodes: BRANCH_TREE,
      expandedNodeIds: ['branch-root', 'active-path', 'off-path'],
    })

    expect(rowIds(rows)).toEqual([
      'branch-root',
      'off-path',
      'off-leaf',
      'active-path',
      'active-leaf',
    ])
    expect(rowDepths(rows)).toEqual([0, 1, 2, 1, 2])
  })

  it('orders the active-path branch before off-path siblings', () => {
    const rows = visibleRows({
      nodes: BRANCH_TREE,
      expandedNodeIds: ['branch-root', 'active-path', 'off-path'],
      activePathIds: ['branch-root', 'active-path', 'active-leaf'],
    })

    expect(rowIds(rows)).toEqual([
      'branch-root',
      'active-path',
      'active-leaf',
      'off-path',
      'off-leaf',
    ])
  })

  it('reattaches descendants to the nearest visible ancestor when filters hide intermediate nodes', () => {
    const hiddenParentTree = [
      node({ id: 'root', depth: 0, order: 1 }),
      node({ id: 'hidden-tool', parentId: 'root', depth: 1, order: 2 }),
      node({ id: 'visible-child', parentId: 'hidden-tool', depth: 2, order: 3 }),
      node({ id: 'visible-sibling', parentId: 'root', depth: 1, order: 4 }),
    ]
    const rows = visibleRows({
      nodes: hiddenParentTree,
      filteredNodes: [
        nodeAt(hiddenParentTree, 0),
        nodeAt(hiddenParentTree, 2),
        nodeAt(hiddenParentTree, 3),
      ],
      expandedNodeIds: ['root', 'hidden-tool'],
    })

    expect(rowIds(rows)).toEqual(['root', 'visible-child', 'visible-sibling'])
    expect(rows[SECOND_ROW_INDEX]?.visibleParentId).toBe(SessionNodeId('root'))
    expect(rowDepths(rows)).toEqual([0, 1, 1])
  })

  it('does not mark a node as expandable when all descendants are filtered out', () => {
    const filteredRows = visibleRows({
      nodes: TREE,
      filteredNodes: [nodeAt(TREE, 0), nodeAt(TREE, 4)],
      expandedNodeIds: ['root', 'child-a'],
    })

    expect(filteredRows[FIRST_ROW_INDEX]?.hasExpandableChildren).toBe(false)
    expect(filteredRows[FIRST_ROW_INDEX]?.expandableChildCount).toBe(0)
  })

  it('keeps collapsed rows expandable so users can reopen them', () => {
    const rows = visibleRows({ nodes: TREE, expandedNodeIds: [] })

    expect(rowIds(rows)).toEqual(['root', 'sibling-root'])
    expect(rows[FIRST_ROW_INDEX]?.hasExpandableChildren).toBe(true)
    expect(rows[FIRST_ROW_INDEX]?.hasDisplayedChildren).toBe(false)
  })
})

describe('getVisibleSessionTreeNodes', () => {
  it('returns the visible row nodes for node-only callers', () => {
    const nodes = getVisibleSessionTreeNodes(TREE, [SessionNodeId('root')])

    expect(nodes.map((visibleNode) => String(visibleNode.id))).toEqual([
      'root',
      'child-a',
      'child-b',
      'sibling-root',
    ])
  })
})
