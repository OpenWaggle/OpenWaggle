import { SessionNodeId } from '@shared/types/brand'
import type { SessionTree } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { node, SESSION_ID, treeUiState } from '../../lib/__tests__/session-tree-test-fixtures'
import { buildSessionTreePanelRows } from '../session-tree-panel-rows'
import { sessionTreePanelReducer } from '../session-tree-panel-state'

function makeTree() {
  const root = node({ id: 'root', depth: 0, order: 1 })
  const user = {
    ...node({ id: 'user', parentId: 'root', depth: 1, order: 2 }),
    kind: 'user_message',
  }
  const tool = {
    ...node({ id: 'tool', parentId: 'user', depth: 2, order: 3 }),
    kind: 'tool_result',
  }

  return {
    session: {
      id: SESSION_ID,
      title: 'Session',
      projectPath: '/repo',
      createdAt: 1,
      updatedAt: 1,
    },
    nodes: [root, user, tool],
    branches: [],
    branchStates: [],
    uiState: treeUiState({ expandedNodeIds: ['root'], expandedNodeIdsTouched: true }),
  } satisfies SessionTree
}

describe('session tree panel row state', () => {
  it('reduces focus and expanded-node override changes independently', () => {
    const withFocus = sessionTreePanelReducer(
      { expandedNodeIdsOverride: null, focusIndex: 0 },
      { type: 'set-focus-index', value: 2 },
    )
    const next = sessionTreePanelReducer(withFocus, {
      type: 'set-expanded-node-ids-override',
      value: { sessionId: SESSION_ID, nodeIds: [SessionNodeId('root')] },
    })

    expect(next.focusIndex).toBe(2)
    expect(next.expandedNodeIdsOverride?.nodeIds).toEqual([SessionNodeId('root')])
  })

  it('builds rows from tree filters, search, transcript path, and expansion overrides', () => {
    const tree = makeTree()
    const result = buildSessionTreePanelRows({
      tree,
      transcriptPath: [{ node: tree.nodes[0] }, { node: tree.nodes[1] }],
      filterMode: 'no-tools',
      searchQuery: 'user',
      focusIndex: 9,
      expandedNodeIdsOverride: {
        sessionId: SESSION_ID,
        nodeIds: [SessionNodeId('root'), SessionNodeId('user')],
      },
    })

    expect(result.searchActive).toBe(true)
    expect(result.clampedFocusIndex).toBe(1)
    expect(result.activePathIds.has('user')).toBe(true)
    expect(result.visibleNodes.map((visibleNode) => String(visibleNode.id))).toEqual([
      'root',
      'user',
    ])
    expect(result.expandedNodeIds.map(String)).toEqual(['root', 'user'])
  })

  it('returns empty rows when no tree is available', () => {
    const result = buildSessionTreePanelRows({
      tree: null,
      transcriptPath: [],
      filterMode: 'default',
      searchQuery: '',
      focusIndex: 1,
      expandedNodeIdsOverride: null,
    })

    expect(result.visibleRows).toEqual([])
    expect(result.clampedFocusIndex).toBe(0)
  })
})
