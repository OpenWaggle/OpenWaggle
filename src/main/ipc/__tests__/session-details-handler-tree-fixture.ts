import { SessionId } from '@shared/types/brand'
import type { SessionTree } from '@shared/types/session'

export const SESSION_DETAILS_HANDLER_SOURCE_TREE: SessionTree = {
  session: {
    id: SessionId('session-source'),
    title: 'Source session',
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt: 1,
  },
  nodes: [],
  branches: [],
  branchStates: [],
  uiState: null,
}
