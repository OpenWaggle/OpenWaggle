import { MessageId, SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionNode } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { resolveTranscriptMessages } from '../session-workspace-transcript'

const SESSION_ID = SessionId('session-1')
const SESSION_DETAIL_ID = SessionId('session-1')
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
  options: { readonly messageId?: string; readonly branchId?: SessionBranchId } = {},
): SessionNode {
  const messageId = options.messageId ?? id
  const branchId = options.branchId ?? MAIN_BRANCH_ID
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
    branchId,
    message: {
      id: MessageId(messageId),
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
  updatedAt = 4,
  sessionHeadNodeId = lastActiveNodeId,
) {
  return {
    tree: {
      session: {
        id: SESSION_ID,
        title: 'Branch test',
        projectPath: '/tmp/project',
        createdAt: 1,
        updatedAt,
        lastActiveNodeId: sessionHeadNodeId,
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

function activeNodeIdCreatedOrder(nodes: readonly SessionNode[], activeNodeId: SessionNodeId) {
  const activeNode = nodes.find((node) => node.id === activeNodeId)
  if (!activeNode) {
    throw new Error(`Missing active node fixture ${String(activeNodeId)}`)
  }
  return activeNode.createdOrder
}

describe('resolveTranscriptMessages in a retry draft', () => {
  it('keeps a retried message out of its own retry draft when its row kept an optimistic id', () => {
    const first = sessionNode('first', null, 'user', 'First', 0)
    const firstAnswer = sessionNode('first-answer', 'first', 'assistant', 'First answer', 1)
    const retried = sessionNode('retried', 'first-answer', 'user', 'Retry me', 2)
    const retriedAnswer = sessionNode('retried-answer', 'retried', 'assistant', 'Old answer', 3)
    // A message sent in this window is reconciled with its persisted node but keeps its id.
    const reconciledRetried: UIMessage = {
      ...uiMessage('optimistic-user-1', 'user', 'Retry me'),
      metadata: { sessionNodeId: 'retried', sessionNodeCreatedOrder: 2 },
    }

    const resolved = resolveTranscriptMessages({
      activeSessionId: SESSION_DETAIL_ID,
      activeWorkspace: workspaceWithPath(
        [first, firstAnswer, retried, retriedAnswer],
        firstAnswer.id,
        retriedAnswer.id,
      ),
      draftBranchSourceNodeId: firstAnswer.id,
      messages: [
        uiMessage('first', 'user', 'First'),
        uiMessage('first-answer', 'assistant', 'First answer'),
        reconciledRetried,
        uiMessage('retried-answer', 'assistant', 'Old answer'),
      ],
    })

    expect(resolved.map((message) => message.id)).toEqual(['first', 'first-answer'])
  })
})
