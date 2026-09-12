import { SessionBranchId, SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionNode, SessionWorkspace } from '@shared/types/session'
import { vi } from 'vitest'
import type { useBranchSummaryWorkflow } from '../useBranchSummaryWorkflow'

export const SESSION_ID = SessionId('session-1')
export const SOURCE_ID = SessionNodeId('root-assistant')
export const MESSAGE: UIMessage = {
  id: 'branch-point',
  role: 'user',
  parts: [{ type: 'text', content: 'Branch from this user node' }],
}

function node(id: string, parentId: string | null): SessionNode {
  return {
    id: SessionNodeId(id),
    sessionId: SESSION_ID,
    parentId: parentId === null ? null : SessionNodeId(parentId),
    piEntryType: 'message',
    kind: id === MESSAGE.id ? 'user_message' : 'assistant_message',
    role: id === MESSAGE.id ? 'user' : 'assistant',
    timestampMs: 1,
    createdOrder: 1,
    pathDepth: 1,
    contentJson: '{}',
    metadataJson: '{}',
  }
}

export function workspace(sessionId = SESSION_ID): SessionWorkspace {
  const nodes = [
    node('root-assistant', null),
    node('branch-point', 'root-assistant'),
    node('main-continuation', 'branch-point'),
  ].map((entry) => ({ ...entry, sessionId }))
  return {
    tree: {
      session: {
        id: sessionId,
        title: 'Branch fixture',
        projectPath: '/repo',
        createdAt: 1,
        updatedAt: 1,
      },
      nodes,
      branches: [],
      branchStates: [],
      uiState: null,
    },
    activeBranchId: SessionBranchId('main'),
    activeNodeId: SessionNodeId('main-continuation'),
    transcriptPath: nodes.map((entry) => ({
      node: entry,
      isActive: entry.id === 'main-continuation',
    })),
  }
}

export function workflowParams(
  activeWorkspace: SessionWorkspace | null = null,
): Parameters<typeof useBranchSummaryWorkflow>[0] {
  return {
    activeSessionId: SESSION_ID,
    activeWorkspace,
    clearDraftBranchForSession: vi.fn(),
    loadSessions: vi.fn().mockResolvedValue(undefined),
    model: SupportedModelId('openai/gpt-5.5'),
    navigate: vi.fn().mockResolvedValue(undefined),
    projectPath: '/fallback-repo',
    refreshSession: vi.fn().mockResolvedValue(undefined),
    refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
    showToast: vi.fn(),
  } satisfies Parameters<typeof useBranchSummaryWorkflow>[0]
}

export function deferredWorkspace() {
  let resolve: (value: SessionWorkspace | null) => void = () => {
    throw new Error('Promise not initialized')
  }
  let reject: (reason: Error) => void = () => {
    throw new Error('Promise not initialized')
  }
  const promise = new Promise<SessionWorkspace | null>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}
