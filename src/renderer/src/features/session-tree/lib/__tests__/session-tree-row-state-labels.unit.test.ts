import { MessageId, SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionBranch, SessionNode, SessionTree } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { sessionTreeNodeLabel, sessionTreeNodeRoleLabel } from '../session-tree-row-labels'
import { buildSessionTreeRowState } from '../session-tree-row-state'
import { node, SESSION_ID } from './session-tree-test-fixtures'

function branch(input: {
  readonly id: string
  readonly headNodeId: string
  readonly archived?: boolean
}) {
  return {
    id: SessionBranchId(input.id),
    sessionId: SESSION_ID,
    sourceNodeId: null,
    headNodeId: SessionNodeId(input.headNodeId),
    name: input.id,
    isMain: input.id === 'active',
    archived: input.archived ?? false,
    createdAt: 1,
    updatedAt: 1,
  } satisfies SessionBranch
}

function tree(targetNode: SessionNode) {
  return {
    session: {
      id: SESSION_ID,
      title: 'Session',
      projectPath: null,
      lastActiveBranchId: SessionBranchId('active'),
      createdAt: 1,
      updatedAt: 1,
    },
    nodes: [node({ id: 'root', depth: 0, order: 1 }), targetNode],
    branches: [
      branch({ id: 'active', headNodeId: String(targetNode.id) }),
      branch({ id: 'archived', headNodeId: String(targetNode.id), archived: true }),
    ],
    branchStates: [],
    uiState: null,
  } satisfies SessionTree
}

describe('session tree row labels and state', () => {
  it('uses compact message text as the row label before falling back to node kind', () => {
    const messageNode = {
      ...node({ id: 'user-node', depth: 1, order: 2 }),
      kind: 'user_message',
      message: {
        id: MessageId('message-1'),
        role: 'user',
        parts: [{ type: 'text', text: '  hello\n\nworld  ' }],
        createdAt: 1,
      },
    } satisfies SessionNode

    const branchSummaryNode = {
      ...node({ id: 'branch-summary-node', depth: 1, order: 3 }),
      kind: 'branch_summary',
    } satisfies SessionNode

    expect(sessionTreeNodeLabel(messageNode)).toBe('hello world')
    expect(sessionTreeNodeRoleLabel(messageNode)).toBe('User')
    expect(sessionTreeNodeLabel(branchSummaryNode)).toBe('branch summary')
  })

  it('derives row highlight state from active path, active branch head, draft branch, and archived branches', () => {
    const targetNode = node({ id: 'target', parentId: 'root', depth: 1, order: 2 })
    const viewTree = tree(targetNode)

    const state = buildSessionTreeRowState({
      row: {
        node: targetNode,
        visibleParentId: SessionNodeId('root'),
        visualDepth: 1,
        parentVisualDepth: 0,
        gutterDepths: [],
        hasPreviousSibling: false,
        hasNextSibling: false,
        hasDisplayedChildren: false,
        hasExpandableChildren: false,
        expandableChildCount: 0,
      },
      view: {
        activeBranchId: SessionBranchId('active'),
        activePathIds: new Set([String(targetNode.id)]),
        clampedFocusIndex: 0,
        draftBranch: { sessionId: SessionId('session-1'), sourceNodeId: targetNode.id },
        rowExpandedNodeIds: [targetNode.id],
        tree: viewTree,
        visibleRows: [],
      },
    })

    expect(state.activePath).toBe(true)
    expect(state.expanded).toBe(true)
    expect(state.isActiveBranchHead).toBe(true)
    expect(state.isDraftNode).toBe(true)
    expect(state.nodeHighlighted).toBe(true)
    expect(state.rowHighlighted).toBe(true)
    expect(state.archivedBranch?.id).toBe(SessionBranchId('archived'))
  })
})
