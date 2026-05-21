import { MessageId, SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionTree } from '@shared/types/session'

export const runServiceSessionId = SessionId('session-1')
export const runServiceBranchId = SessionBranchId('session-1:main')

export const runServiceSession: SessionDetail = {
  id: runServiceSessionId,
  title: 'Existing session',
  projectPath: '/tmp/project',
  piSessionId: 'pi-session-1',
  piSessionFile: '/tmp/pi-session-1.jsonl',
  messages: [
    {
      id: MessageId('user-previous'),
      role: 'user',
      parts: [{ type: 'text', text: 'Existing prompt' }],
      createdAt: 1,
    },
  ],
  createdAt: 1,
  updatedAt: 2,
}

export const runServiceNewSession: SessionDetail = {
  id: runServiceSessionId,
  title: 'New session',
  projectPath: '/tmp/project',
  piSessionId: 'pi-session-1',
  piSessionFile: '/tmp/pi-session-1.jsonl',
  messages: [],
  createdAt: 1,
  updatedAt: 2,
}

export const runServiceSessionTree: SessionTree = {
  session: {
    id: runServiceSessionId,
    title: 'Existing session',
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt: 2,
    lastActiveNodeId: null,
    lastActiveBranchId: runServiceBranchId,
  },
  nodes: [],
  branches: [
    {
      id: runServiceBranchId,
      sessionId: runServiceSessionId,
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
