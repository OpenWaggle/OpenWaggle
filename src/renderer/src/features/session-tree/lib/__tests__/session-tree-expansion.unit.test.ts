import { SessionNodeId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  getDefaultExpandedSessionTreeNodeIds,
  resolveExpandedSessionTreeNodeIds,
  resolveSessionTreeRowExpandedNodeIds,
} from '../session-tree-visibility'
import { LINEAR_TREE, TREE, treeUiState } from './session-tree-test-fixtures'

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
