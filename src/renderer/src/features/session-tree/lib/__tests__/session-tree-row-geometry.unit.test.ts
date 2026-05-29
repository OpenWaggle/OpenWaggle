import { describe, expect, it } from 'vitest'
import { getSessionTreeRowGeometry } from '../session-tree-visibility'
import {
  BRANCH_LEAF_SIBLING_TREE,
  BRANCH_TREE,
  connectorLineXs,
  FIRST_BRANCH_DOT_X,
  LINEAR_TREE,
  ROOT_DOT_X,
  ROW_BOTTOM_OVERLAP_Y,
  ROW_CENTER_Y,
  ROW_TOP_OVERLAP_Y,
  rowAt,
  SECOND_BRANCH_DOT_X,
  SECOND_ROW_INDEX,
  THIRD_ROW_INDEX,
  visibleRows,
} from './session-tree-test-fixtures'

describe('getSessionTreeRowGeometry', () => {
  it('keeps linear child connectors on one rail', () => {
    const rows = visibleRows({
      nodes: LINEAR_TREE,
      expandedNodeIds: ['linear-root', 'linear-child'],
    })
    const childGeometry = getSessionTreeRowGeometry(rowAt(rows, SECOND_ROW_INDEX))

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
    const activeBranchGeometry = getSessionTreeRowGeometry(rowAt(rows, SECOND_ROW_INDEX))
    const activeLeafGeometry = getSessionTreeRowGeometry(rowAt(rows, THIRD_ROW_INDEX))

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
    const activeLeafGeometry = getSessionTreeRowGeometry(rowAt(rows, THIRD_ROW_INDEX))

    expect(connectorLineXs(activeLeafGeometry.ancestorLines)).toEqual([ROOT_DOT_X])
  })

  it('does not emit a node-depth bottom stub for a branch leaf with a following sibling', () => {
    const rows = visibleRows({ nodes: BRANCH_LEAF_SIBLING_TREE, expandedNodeIds: ['branch-root'] })
    const firstLeafGeometry = getSessionTreeRowGeometry(rowAt(rows, SECOND_ROW_INDEX))

    expect(firstLeafGeometry.branchElbow?.targetCenterXPx).toBe(firstLeafGeometry.nodeCenterXPx)
    expect(firstLeafGeometry.nodeStemBottom).toBeNull()
    expect(firstLeafGeometry.parentStemBottom).toEqual({
      xPx: ROOT_DOT_X,
      yStartPx: ROW_CENTER_Y,
      yEndPx: ROW_BOTTOM_OVERLAP_Y,
    })
  })

  it('does not emit a node-depth top stem for different-depth branch children', () => {
    const rows = visibleRows({ nodes: BRANCH_LEAF_SIBLING_TREE, expandedNodeIds: ['branch-root'] })
    const firstLeafGeometry = getSessionTreeRowGeometry(rowAt(rows, SECOND_ROW_INDEX))

    expect(firstLeafGeometry.parentCenterXPx).toBe(ROOT_DOT_X)
    expect(firstLeafGeometry.nodeCenterXPx).toBe(FIRST_BRANCH_DOT_X)
    expect(firstLeafGeometry.nodeStemTop).toBeNull()
  })
})
