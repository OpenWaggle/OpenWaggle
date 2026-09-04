import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionNode, SessionWorkspace } from '@shared/types/session'

const SESSION_ID = SessionId('session-1')
const MAIN_BRANCH_ID = SessionBranchId('session-1:main')
export const INACTIVE_BRANCH_ID = SessionBranchId('session-1:inactive')

export function workspaceAtInactiveBranchHead(
  sessionHead: SessionNode,
  inactiveBranchHead: SessionNode,
): SessionWorkspace {
  return {
    tree: {
      session: {
        id: SESSION_ID,
        title: 'Branch test',
        projectPath: '/tmp/project',
        createdAt: 1,
        updatedAt: 4,
        lastActiveNodeId: sessionHead.id,
        lastActiveBranchId: MAIN_BRANCH_ID,
      },
      nodes: [sessionHead, inactiveBranchHead],
      branches: [
        {
          id: MAIN_BRANCH_ID,
          sessionId: SESSION_ID,
          sourceNodeId: null,
          headNodeId: sessionHead.id,
          name: 'main',
          isMain: true,
          createdAt: 1,
          updatedAt: 4,
        },
        {
          id: INACTIVE_BRANCH_ID,
          sessionId: SESSION_ID,
          sourceNodeId: null,
          headNodeId: inactiveBranchHead.id,
          name: 'inactive',
          isMain: false,
          createdAt: 2,
          updatedAt: 4,
        },
      ],
      branchStates: [],
      uiState: null,
    },
    activeBranchId: INACTIVE_BRANCH_ID,
    activeNodeId: inactiveBranchHead.id,
    transcriptPath: [
      {
        node: inactiveBranchHead,
        branchId: INACTIVE_BRANCH_ID,
        isActive: true,
      },
    ],
  }
}
