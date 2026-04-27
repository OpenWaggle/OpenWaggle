import {
  ConversationId,
  MessageId,
  SessionBranchId,
  SessionId,
  SessionNodeId,
} from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionNode, SessionWorkspace } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { resolveTranscriptMessages } from '../session-workspace-transcript'

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
  lastActiveNodeId: SessionNodeId,
): SessionWorkspace {
  return {
    tree: {
      session: {
        id: SESSION_ID,
        title: 'Branch test',
        projectPath: '/tmp/project',
        createdAt: 1,
        updatedAt: 4,
        lastActiveNodeId,
        lastActiveBranchId: MAIN_BRANCH_ID,
      },
      nodes,
      branches: [
        {
          id: MAIN_BRANCH_ID,
          sessionId: SESSION_ID,
          sourceNodeId: null,
          headNodeId: lastActiveNodeId,
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
      .filter((node) => node.createdOrder <= activeNodeIdCreatedOrder(nodes, activeNodeId))
      .map((node) => ({
        node,
        branchId: node.branchId,
        isActive: node.id === activeNodeId,
      })),
  }
}

function activeNodeIdCreatedOrder(
  nodes: readonly SessionNode[],
  activeNodeId: SessionNodeId,
): number {
  const activeNode = nodes.find((node) => node.id === activeNodeId)
  if (!activeNode) {
    throw new Error(`Missing active node fixture ${String(activeNodeId)}`)
  }
  return activeNode.createdOrder
}

describe('resolveTranscriptMessages', () => {
  it('uses the selected workspace transcript path instead of later main-branch messages', () => {
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

    const resolved = resolveTranscriptMessages({
      activeConversationId: CONVERSATION_ID,
      activeWorkspace: workspaceWithPath(
        [beforeBranch, answerBeforeBranch, branchPoint, afterBranch],
        branchPoint.id,
        afterBranch.id,
      ),
      isRunning: false,
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
    })

    expect(resolved.map((message) => message.id)).toEqual([
      'user-before-branch',
      'assistant-before-branch',
      'user-branch-point',
    ])
  })

  it('preserves live tail messages when the selected workspace is already at the active branch head', () => {
    const user = sessionNode('user-head', null, 'user', 'Head user', 0)
    const assistant = sessionNode('assistant-head', 'user-head', 'assistant', 'Head answer', 1)

    const resolved = resolveTranscriptMessages({
      activeConversationId: CONVERSATION_ID,
      activeWorkspace: workspaceWithPath([user, assistant], assistant.id, assistant.id),
      isRunning: true,
      messages: [
        uiMessage('user-head', 'user', 'Head user'),
        uiMessage('assistant-head', 'assistant', 'Head answer'),
        uiMessage('live-user', 'user', 'Live follow-up'),
        uiMessage('live-assistant', 'assistant', 'Live response'),
      ],
    })

    expect(resolved.map((message) => message.id)).toEqual([
      'user-head',
      'assistant-head',
      'live-user',
      'live-assistant',
    ])
  })
})
