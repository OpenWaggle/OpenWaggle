import { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionNode, SessionTreeUiState } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import {
  clampSessionTreeFocusIndex,
  findFirstVisibleChildIndex,
  findVisibleParentIndex,
  getDefaultExpandedSessionTreeNodeIds,
  getSessionTreeRowGeometry,
  getVisibleSessionTreeNodes,
  getVisibleSessionTreeRows,
  moveSessionTreeFocus,
  resolveExpandedSessionTreeNodeIds,
  resolveSessionTreeRowExpandedNodeIds,
  type SessionTreeRow,
} from '../session-tree-visibility'

const SESSION_ID = SessionId('session-1')
const FIRST_ROW_INDEX = 0
const SECOND_ROW_INDEX = 1
const THIRD_ROW_INDEX = 2
const FIFTH_ROW_INDEX = 4
const ROOT_DOT_X = 14
const FIRST_BRANCH_DOT_X = 38
const SECOND_BRANCH_DOT_X = 62
const ROW_TOP_OVERLAP_Y = -1
const ROW_CENTER_Y = 20
const ROW_BOTTOM_OVERLAP_Y = 41

function node(input: {
  readonly id: string
  readonly parentId?: string | null
  readonly depth: number
  readonly order: number
}): SessionNode {
  return {
    id: SessionNodeId(input.id),
    sessionId: SESSION_ID,
    parentId: input.parentId ? SessionNodeId(input.parentId) : null,
    piEntryType: 'message',
    kind: 'assistant_message',
    timestampMs: input.order,
    createdOrder: input.order,
    pathDepth: input.depth,
    contentJson: '{}',
    metadataJson: '{}',
  }
}

function treeUiState(input: {
  readonly expandedNodeIds: readonly string[]
  readonly expandedNodeIdsTouched: boolean
}): SessionTreeUiState {
  return {
    sessionId: SESSION_ID,
    expandedNodeIds: input.expandedNodeIds.map(SessionNodeId),
    expandedNodeIdsTouched: input.expandedNodeIdsTouched,
    branchesSidebarCollapsed: false,
    updatedAt: 1,
  }
}

function rowIds(rows: readonly SessionTreeRow[]): readonly string[] {
  return rows.map((row) => String(row.node.id))
}

function rowDepths(rows: readonly SessionTreeRow[]): readonly number[] {
  return rows.map((row) => row.visualDepth)
}

function connectorLineXs(
  lines: readonly { readonly xPx: number; readonly yStartPx: number; readonly yEndPx: number }[],
): readonly number[] {
  return lines.map((line) => line.xPx)
}

function visibleRows(input: {
  readonly nodes: readonly SessionNode[]
  readonly filteredNodes?: readonly SessionNode[]
  readonly expandedNodeIds?: readonly string[]
  readonly activePathIds?: readonly string[]
}): readonly SessionTreeRow[] {
  return getVisibleSessionTreeRows({
    nodes: input.nodes,
    filteredNodes: input.filteredNodes ?? input.nodes,
    expandedNodeIds: (input.expandedNodeIds ?? []).map(SessionNodeId),
    activePathIds: new Set(input.activePathIds ?? []),
  })
}

const TREE = [
  node({ id: 'root', depth: 0, order: 1 }),
  node({ id: 'child-a', parentId: 'root', depth: 1, order: 2 }),
  node({ id: 'grandchild-a', parentId: 'child-a', depth: 2, order: 3 }),
  node({ id: 'child-b', parentId: 'root', depth: 1, order: 4 }),
  node({ id: 'sibling-root', depth: 0, order: 5 }),
]

const LINEAR_TREE = [
  node({ id: 'linear-root', depth: 0, order: 1 }),
  node({ id: 'linear-child', parentId: 'linear-root', depth: 1, order: 2 }),
  node({ id: 'linear-grandchild', parentId: 'linear-child', depth: 2, order: 3 }),
]

const BRANCH_TREE = [
  node({ id: 'branch-root', depth: 0, order: 1 }),
  node({ id: 'off-path', parentId: 'branch-root', depth: 1, order: 2 }),
  node({ id: 'active-path', parentId: 'branch-root', depth: 1, order: 3 }),
  node({ id: 'active-leaf', parentId: 'active-path', depth: 2, order: 4 }),
  node({ id: 'off-leaf', parentId: 'off-path', depth: 2, order: 5 }),
]

const BRANCH_LEAF_SIBLING_TREE = [
  node({ id: 'branch-root', depth: 0, order: 1 }),
  node({ id: 'first-leaf', parentId: 'branch-root', depth: 1, order: 2 }),
  node({ id: 'second-leaf', parentId: 'branch-root', depth: 1, order: 3 }),
]

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
      filteredNodes: [hiddenParentTree[0], hiddenParentTree[2], hiddenParentTree[3]],
      expandedNodeIds: ['root', 'hidden-tool'],
    })

    expect(rowIds(rows)).toEqual(['root', 'visible-child', 'visible-sibling'])
    expect(rows[SECOND_ROW_INDEX]?.visibleParentId).toBe(SessionNodeId('root'))
    expect(rowDepths(rows)).toEqual([0, 1, 1])
  })

  it('does not mark a node as expandable when all descendants are filtered out', () => {
    const filteredRows = visibleRows({
      nodes: TREE,
      filteredNodes: [TREE[0], TREE[4]],
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

describe('getDefaultExpandedSessionTreeNodeIds', () => {
  it('expands every parent node by default', () => {
    expect(
      getDefaultExpandedSessionTreeNodeIds(TREE).map((expandedNodeId) => String(expandedNodeId)),
    ).toEqual(['root', 'child-a'])
  })
})

describe('resolveExpandedSessionTreeNodeIds', () => {
  it('defaults untouched empty expansion state to every parent node', () => {
    const resolved = resolveExpandedSessionTreeNodeIds({
      nodes: TREE,
      uiState: treeUiState({ expandedNodeIds: [], expandedNodeIdsTouched: false }),
      overrideNodeIds: null,
    })

    expect(resolved.map((expandedNodeId) => String(expandedNodeId))).toEqual(['root', 'child-a'])
  })

  it('preserves an explicitly touched empty expansion state', () => {
    const resolved = resolveExpandedSessionTreeNodeIds({
      nodes: TREE,
      uiState: treeUiState({ expandedNodeIds: [], expandedNodeIdsTouched: true }),
      overrideNodeIds: null,
    })

    expect(resolved).toEqual([])
  })

  it('prefers the current in-panel override over stored state', () => {
    const resolved = resolveExpandedSessionTreeNodeIds({
      nodes: TREE,
      uiState: treeUiState({ expandedNodeIds: ['root'], expandedNodeIdsTouched: true }),
      overrideNodeIds: [SessionNodeId('child-a')],
    })

    expect(resolved.map((expandedNodeId) => String(expandedNodeId))).toEqual(['child-a'])
  })
})

describe('resolveSessionTreeRowExpandedNodeIds', () => {
  it('temporarily expands search result parents so matches under collapsed nodes are visible', () => {
    const resolved = resolveSessionTreeRowExpandedNodeIds({
      filteredNodes: LINEAR_TREE,
      expandedNodeIds: [],
      searchActive: true,
    })

    expect(resolved.map((expandedNodeId) => String(expandedNodeId))).toEqual([
      'linear-root',
      'linear-child',
    ])
  })

  it('preserves user expansion state outside search', () => {
    const resolved = resolveSessionTreeRowExpandedNodeIds({
      filteredNodes: LINEAR_TREE,
      expandedNodeIds: [SessionNodeId('linear-root')],
      searchActive: false,
    })

    expect(resolved.map((expandedNodeId) => String(expandedNodeId))).toEqual(['linear-root'])
  })
})

describe('getSessionTreeRowGeometry', () => {
  it('keeps linear child connectors on one rail', () => {
    const rows = visibleRows({
      nodes: LINEAR_TREE,
      expandedNodeIds: ['linear-root', 'linear-child'],
    })
    const childGeometry = getSessionTreeRowGeometry(rows[SECOND_ROW_INDEX])

    expect(childGeometry.parentCenterXPx).toBe(ROOT_DOT_X)
    expect(childGeometry.nodeCenterXPx).toBe(ROOT_DOT_X)
    expect(childGeometry.branchElbow).toBeNull()
    expect(childGeometry.nodeStemTop).toEqual({
      xPx: ROOT_DOT_X,
      yStartPx: ROW_TOP_OVERLAP_Y,
      yEndPx: ROW_CENTER_Y,
    })
    expect(childGeometry.nodeStemBottom).toEqual({
      xPx: ROOT_DOT_X,
      yStartPx: ROW_CENTER_Y,
      yEndPx: ROW_BOTTOM_OVERLAP_Y,
    })
  })

  it('draws branch elbows from parent rails to the target dot center', () => {
    const rows = visibleRows({
      nodes: BRANCH_TREE,
      expandedNodeIds: ['branch-root', 'active-path', 'off-path'],
      activePathIds: ['branch-root', 'active-path', 'active-leaf'],
    })
    const activeBranchGeometry = getSessionTreeRowGeometry(rows[SECOND_ROW_INDEX])
    const activeLeafGeometry = getSessionTreeRowGeometry(rows[THIRD_ROW_INDEX])

    expect(activeBranchGeometry.parentCenterXPx).toBe(ROOT_DOT_X)
    expect(activeBranchGeometry.nodeCenterXPx).toBe(FIRST_BRANCH_DOT_X)
    expect(activeBranchGeometry.branchElbow).toEqual({
      parentCenterXPx: ROOT_DOT_X,
      targetCenterXPx: FIRST_BRANCH_DOT_X,
      yStartPx: ROW_TOP_OVERLAP_Y,
      yMidPx: ROW_CENTER_Y,
    })
    expect(activeBranchGeometry.nodeStemTop).toBeNull()
    expect(activeBranchGeometry.parentStemBottom).toEqual({
      xPx: ROOT_DOT_X,
      yStartPx: ROW_CENTER_Y,
      yEndPx: ROW_BOTTOM_OVERLAP_Y,
    })
    expect(activeLeafGeometry.parentCenterXPx).toBe(FIRST_BRANCH_DOT_X)
    expect(activeLeafGeometry.nodeCenterXPx).toBe(SECOND_BRANCH_DOT_X)
    expect(activeLeafGeometry.branchElbow?.targetCenterXPx).toBe(activeLeafGeometry.nodeCenterXPx)
  })

  it('carries ancestor sibling continuations on the parent rail through descendants', () => {
    const rows = visibleRows({
      nodes: BRANCH_TREE,
      expandedNodeIds: ['branch-root', 'active-path', 'off-path'],
      activePathIds: ['branch-root', 'active-path', 'active-leaf'],
    })
    const activeLeafGeometry = getSessionTreeRowGeometry(rows[THIRD_ROW_INDEX])

    expect(connectorLineXs(activeLeafGeometry.ancestorLines)).toEqual([ROOT_DOT_X])
  })

  it('does not emit a node-depth bottom stub for a branch leaf with a following sibling', () => {
    const rows = visibleRows({
      nodes: BRANCH_LEAF_SIBLING_TREE,
      expandedNodeIds: ['branch-root'],
    })
    const firstLeafGeometry = getSessionTreeRowGeometry(rows[SECOND_ROW_INDEX])

    expect(firstLeafGeometry.branchElbow?.targetCenterXPx).toBe(firstLeafGeometry.nodeCenterXPx)
    expect(firstLeafGeometry.nodeStemBottom).toBeNull()
    expect(firstLeafGeometry.parentStemBottom).toEqual({
      xPx: ROOT_DOT_X,
      yStartPx: ROW_CENTER_Y,
      yEndPx: ROW_BOTTOM_OVERLAP_Y,
    })
  })

  it('does not emit a node-depth top stem for different-depth branch children', () => {
    const rows = visibleRows({
      nodes: BRANCH_LEAF_SIBLING_TREE,
      expandedNodeIds: ['branch-root'],
    })
    const firstLeafGeometry = getSessionTreeRowGeometry(rows[SECOND_ROW_INDEX])

    expect(firstLeafGeometry.parentCenterXPx).toBe(ROOT_DOT_X)
    expect(firstLeafGeometry.nodeCenterXPx).toBe(FIRST_BRANCH_DOT_X)
    expect(firstLeafGeometry.nodeStemTop).toBeNull()
  })
})

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
