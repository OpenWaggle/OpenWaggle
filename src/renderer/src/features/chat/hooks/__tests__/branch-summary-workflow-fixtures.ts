import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type {
  SessionNode,
  SessionTree,
  SessionTreeUiState,
  SessionWorkspace,
} from '@shared/types/session'

export const SESSION_ID = SessionId('session-1')
export const SOURCE_NODE_ID = SessionNodeId('source-node')
export const ACTIVE_NODE_ID = SessionNodeId('active-node')
export const MAIN_BRANCH_ID = SessionBranchId('main')
export const SUMMARY_BRANCH_ID = SessionBranchId('summary-branch')

function node(input: {
  readonly id: string
  readonly parentId?: string | null
  readonly depth: number
  readonly order: number
}) {
  return {
    id: SessionNodeId(input.id),
    sessionId: SESSION_ID,
    parentId: input.parentId ? SessionNodeId(input.parentId) : null,
    piEntryType: 'message',
    kind: 'assistant_message',
    role: 'assistant',
    timestampMs: input.order,
    createdOrder: input.order,
    pathDepth: input.depth,
    contentJson: '{}',
    metadataJson: '{}',
  } satisfies SessionNode
}

function treeUiState() {
  return {
    sessionId: SESSION_ID,
    expandedNodeIds: [SOURCE_NODE_ID],
    expandedNodeIdsTouched: true,
    branchesSidebarCollapsed: false,
    updatedAt: 1,
  } satisfies SessionTreeUiState
}

function tree() {
  const result: SessionTree = {
    session: {
      id: SESSION_ID,
      title: 'Branch workflow',
      projectPath: '/repo',
      createdAt: 1,
      updatedAt: 2,
    },
    nodes: [node({ id: 'source-node', depth: 0, order: 1 })],
    branches: [],
    branchStates: [],
    uiState: treeUiState(),
  }
  return result
}

export function workspace(input: {
  readonly branchId: SessionBranchId
  readonly nodeId: SessionNodeId
  readonly projectPath?: string | null
  readonly sessionId?: SessionId
}) {
  const sessionTree = tree()
  const activeNode = node({ id: String(input.nodeId), depth: 1, order: 2 })
  return {
    tree: {
      ...sessionTree,
      nodes: [...sessionTree.nodes, activeNode],
      session: {
        ...sessionTree.session,
        id: input.sessionId ?? SESSION_ID,
        projectPath: input.projectPath === undefined ? '/repo' : input.projectPath,
      },
    },
    activeBranchId: input.branchId,
    activeNodeId: input.nodeId,
    transcriptPath: [{ node: activeNode, isActive: true }],
  } satisfies SessionWorkspace
}
