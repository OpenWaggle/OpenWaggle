import { MessageId, SessionBranchId, SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionDetail, SessionTree } from '@shared/types/session'
import type {
  AgentKernelRunResult,
  AgentKernelSessionSnapshotResult,
} from '../../ports/agent-kernel-service'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'

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

export function runServiceKernelResult(model: SupportedModelId): AgentKernelRunResult {
  return {
    newMessages: [
      {
        id: MessageId('assistant-1'),
        role: 'assistant',
        parts: [{ type: 'text', text: 'Done' }],
        model,
        createdAt: 3,
      },
    ],
    piSessionId: 'pi-session-1',
    piSessionFile: '/tmp/pi-session-1.jsonl',
    sessionSnapshot: {
      activeNodeId: 'assistant-1',
      nodes: [projectedAssistantNode('assistant-1', 3)],
    },
  }
}

export const runServiceRecoveredSnapshot: AgentKernelSessionSnapshotResult = {
  piSessionId: 'pi-session-1',
  piSessionFile: '/tmp/pi-session-1.jsonl',
  sessionSnapshot: {
    activeNodeId: 'assistant-recovered',
    nodes: [projectedAssistantNode('assistant-recovered', 4)],
  },
}

function projectedAssistantNode(id: string, timestampMs: number): ProjectedSessionNodeInput {
  return {
    id,
    parentId: null,
    piEntryType: 'message',
    kind: 'assistant_message',
    role: 'assistant',
    timestampMs,
    contentJson: '{}',
    metadataJson: '{}',
    pathDepth: 0,
    createdOrder: 0,
  }
}
