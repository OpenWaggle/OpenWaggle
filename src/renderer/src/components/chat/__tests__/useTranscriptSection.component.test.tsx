// @vitest-environment jsdom

import {
  ConversationId,
  MessageId,
  SessionBranchId,
  SessionId,
  SessionNodeId,
  SupportedModelId,
} from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionNode, SessionWorkspace } from '@shared/types/session'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/stores/session-store'
import { useTranscriptSection } from '../hooks/useTranscriptSection'

vi.mock('@/lib/ipc', () => ({
  api: {},
}))

const SESSION_ID = SessionId('session-1')
const CONVERSATION_ID = ConversationId('session-1')
const MAIN_BRANCH_ID = SessionBranchId('session-1:main')

function uiMessage(id: string, role: 'user' | 'assistant', content: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content }],
    createdAt: new Date(1),
  }
}

function sessionNode(
  id: string,
  parentId: string | null,
  role: 'user' | 'assistant',
  content: string,
  createdOrder: number,
): SessionNode {
  return {
    id: SessionNodeId(id),
    sessionId: SESSION_ID,
    parentId: parentId ? SessionNodeId(parentId) : null,
    piEntryType: 'message',
    kind: role === 'user' ? 'user_message' : 'assistant_message',
    role,
    timestampMs: createdOrder + 1,
    createdOrder,
    pathDepth: createdOrder,
    branchId: MAIN_BRANCH_ID,
    message: {
      id: MessageId(id),
      role,
      parts: [{ type: 'text', text: content }],
      createdAt: createdOrder + 1,
    },
    contentJson: JSON.stringify({ parts: [{ type: 'text', text: content }], model: null }),
    metadataJson: '{}',
  }
}

function workspaceWithPath(
  nodes: readonly SessionNode[],
  activeNodeId: SessionNodeId,
): SessionWorkspace {
  return {
    tree: {
      session: {
        id: SESSION_ID,
        title: 'Branch test',
        projectPath: '/tmp/project',
        createdAt: 1,
        updatedAt: 4,
        lastActiveNodeId: SessionNodeId('assistant-after-branch'),
        lastActiveBranchId: MAIN_BRANCH_ID,
      },
      nodes,
      branches: [
        {
          id: MAIN_BRANCH_ID,
          sessionId: SESSION_ID,
          sourceNodeId: null,
          headNodeId: SessionNodeId('assistant-after-branch'),
          name: 'main',
          isMain: true,
          createdAt: 1,
          updatedAt: 4,
        },
      ],
      branchStates: [],
      uiState: null,
    },
    activeBranchId: MAIN_BRANCH_ID,
    activeNodeId,
    transcriptPath: nodes
      .filter((node) => node.createdOrder <= 2)
      .map((node) => ({
        node,
        branchId: node.branchId,
        isActive: node.id === activeNodeId,
      })),
  }
}

const phase = {
  current: null,
  completed: [],
  totalElapsedMs: 0,
  reset: vi.fn(),
}

describe('useTranscriptSection', () => {
  beforeEach(() => {
    useSessionStore.setState({
      ...useSessionStore.getInitialState(),
      activeWorkspace: null,
    })
  })

  it('shows the selected session workspace path instead of later main-branch messages', () => {
    const beforeBranch = sessionNode('user-before-branch', null, 'user', 'Before branch', 0)
    const answerBeforeBranch = sessionNode(
      'assistant-before-branch',
      'user-before-branch',
      'assistant',
      'Answer before branch',
      1,
    )
    const branchPoint = sessionNode(
      'user-branch-point',
      'assistant-before-branch',
      'user',
      'Branch from here',
      2,
    )
    const afterBranch = sessionNode(
      'assistant-after-branch',
      'user-branch-point',
      'assistant',
      'Main branch continuation should be hidden',
      3,
    )

    useSessionStore.setState({
      activeWorkspace: workspaceWithPath(
        [beforeBranch, answerBeforeBranch, branchPoint, afterBranch],
        branchPoint.id,
      ),
    })

    const { result } = renderHook(() =>
      useTranscriptSection({
        messages: [
          uiMessage('user-before-branch', 'user', 'Before branch'),
          uiMessage('assistant-before-branch', 'assistant', 'Answer before branch'),
          uiMessage('user-branch-point', 'user', 'Branch from here'),
          uiMessage(
            'assistant-after-branch',
            'assistant',
            'Main branch continuation should be hidden',
          ),
        ],
        isLoading: false,
        isSteering: false,
        error: undefined,
        streamSignalVersion: 0,
        projectPath: '/tmp/project',
        recentProjects: [],
        activeConversationId: CONVERSATION_ID,
        activeConversation: null,
        model: SupportedModelId('openai/gpt-5'),
        waggleStatus: 'idle',
        phase,
        handleOpenProject: vi.fn(),
        handleSelectProjectPath: vi.fn(),
        handleSendText: vi.fn(),
        openSettings: vi.fn(),
        handleBranchFromMessage: vi.fn(),
        userDidSend: false,
        onUserDidSendConsumed: vi.fn(),
      }),
    )

    const renderedMessages = result.current.chatRows
      .filter((row) => row.type === 'message')
      .map((row) => row.message.id)

    expect(renderedMessages).toEqual([
      'user-before-branch',
      'assistant-before-branch',
      'user-branch-point',
    ])
  })
})
