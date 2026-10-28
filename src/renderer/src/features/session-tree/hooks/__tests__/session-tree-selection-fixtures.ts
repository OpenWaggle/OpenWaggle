import { MessageId, SessionBranchId, SessionId } from '@shared/types/brand'
import type {
  SessionBranch,
  SessionNode,
  SessionTree,
  SessionWorkspace,
} from '@shared/types/session'
import { node, treeUiState } from '../../lib/__tests__/session-tree-test-fixtures'

/** One Session's tree: a root, a user message with its text, and the answer on a branch. */
export const SESSION_ID = SessionId('session-1')
export const ROOT_NODE = node({ id: 'root', depth: 0, order: 1 })
export const USER_NODE: SessionNode = {
  ...node({ id: 'user', parentId: 'root', depth: 1, order: 2, kind: 'user_message' }),
  role: 'user',
  message: {
    id: MessageId('user'),
    role: 'user',
    parts: [{ type: 'text', text: 'Use this prompt' }],
    createdAt: 2,
  },
}
export const ASSISTANT_NODE = node({ id: 'assistant', parentId: 'user', depth: 2, order: 3 })

export function branch(): SessionBranch {
  return {
    id: SessionBranchId('branch-1'),
    sessionId: SESSION_ID,
    sourceNodeId: USER_NODE.id,
    headNodeId: ASSISTANT_NODE.id,
    name: 'branch-1',
    isMain: false,
    createdAt: 1,
    updatedAt: 2,
  }
}

export function tree(): SessionTree {
  return {
    session: {
      id: SESSION_ID,
      title: 'Session tree',
      projectPath: '/repo',
      createdAt: 1,
      updatedAt: 2,
    },
    nodes: [ROOT_NODE, USER_NODE, ASSISTANT_NODE],
    branches: [branch()],
    branchStates: [],
    uiState: treeUiState({ expandedNodeIds: ['root'], expandedNodeIdsTouched: true }),
  }
}

export function workspace(): SessionWorkspace {
  const sessionTree = tree()
  return {
    tree: sessionTree,
    activeBranchId: SessionBranchId('main'),
    activeNodeId: ASSISTANT_NODE.id,
    transcriptPath: [
      { node: ROOT_NODE, isActive: true },
      { node: USER_NODE, isActive: true },
      { node: ASSISTANT_NODE, isActive: true },
    ],
  }
}
