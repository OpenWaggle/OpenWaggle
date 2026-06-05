import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionTree } from '@shared/types/session'

export const BROKER_SESSION_ID = SessionId('session-1')
export const BROKER_BRANCH_ID = SessionBranchId('session-1:main')

export function makeSessionDetail(projectPath: string): SessionDetail {
  return {
    id: BROKER_SESSION_ID,
    title: 'Session',
    projectPath,
    messages: [],
    createdAt: 1,
    updatedAt: 2,
  }
}

export function makeSessionTree(projectPath: string): SessionTree {
  return {
    session: {
      id: BROKER_SESSION_ID,
      title: 'Session',
      projectPath,
      createdAt: 1,
      updatedAt: 2,
      lastActiveBranchId: BROKER_BRANCH_ID,
    },
    nodes: [],
    branches: [
      {
        id: BROKER_BRANCH_ID,
        sessionId: BROKER_SESSION_ID,
        sourceNodeId: null,
        headNodeId: null,
        name: 'main',
        isMain: true,
        archivedAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    branchStates: [],
    uiState: null,
  }
}
