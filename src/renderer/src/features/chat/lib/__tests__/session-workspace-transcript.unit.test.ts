import { MessageId, SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionNode } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { resolveTranscriptMessages } from '../session-workspace-transcript'
import {
  INACTIVE_BRANCH_ID,
  workspaceAtInactiveBranchHead,
} from './session-workspace-transcript.fixtures'

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
  branchId = MAIN_BRANCH_ID,
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
    branchId,
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
      activeSessionId: SESSION_DETAIL_ID,
      activeWorkspace: workspaceWithPath(
        [beforeBranch, answerBeforeBranch, branchPoint, afterBranch],
        branchPoint.id,
        afterBranch.id,
      ),
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
      activeSessionId: SESSION_DETAIL_ID,
      activeWorkspace: workspaceWithPath([user, assistant], assistant.id, assistant.id),
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

  it('keeps completed live tail messages while the workspace snapshot is still catching up', () => {
    const user = sessionNode('user-head', null, 'user', 'Head user', 0)
    const assistant = sessionNode('assistant-head', 'user-head', 'assistant', 'Head answer', 1)

    const resolved = resolveTranscriptMessages({
      activeSessionId: SESSION_DETAIL_ID,
      activeWorkspace: workspaceWithPath([user, assistant], assistant.id, assistant.id),
      messages: [
        uiMessage('user-head', 'user', 'Head user'),
        uiMessage('assistant-head', 'assistant', 'Head answer'),
        uiMessage('completed-assistant', 'assistant', 'Completed response still visible'),
      ],
    })

    expect(resolved.map((message) => message.id)).toEqual([
      'user-head',
      'assistant-head',
      'completed-assistant',
    ])
  })

  it('keeps a replacement message snapshot visible when the active-head workspace is stale', () => {
    const visualization = sessionNode(
      'visualization-assistant',
      null,
      'assistant',
      'Interactive visualization',
      0,
    )

    const resolved = resolveTranscriptMessages({
      activeSessionId: SESSION_DETAIL_ID,
      activeSessionUpdatedAt: 10,
      activeWorkspace: workspaceWithPath([visualization], visualization.id, visualization.id, 4),
      messages: [
        uiMessage('replacement-user', 'user', 'What did I select?'),
        uiMessage('replacement-assistant', 'assistant', 'You selected sandbox.'),
      ],
    })

    expect(resolved.map((message) => message.id)).toEqual([
      'visualization-assistant',
      'replacement-user',
      'replacement-assistant',
    ])
  })

  it('accepts a visible active-branch head when the raw session head is hidden', () => {
    const visibleAssistant = sessionNode(
      'visible-assistant',
      null,
      'assistant',
      'Visible answer before hidden state',
      0,
    )

    const resolved = resolveTranscriptMessages({
      activeSessionId: SESSION_DETAIL_ID,
      activeSessionUpdatedAt: 10,
      activeWorkspace: workspaceWithPath(
        [visibleAssistant],
        visibleAssistant.id,
        visibleAssistant.id,
        4,
        SessionNodeId('hidden-mode-state'),
      ),
      messages: [
        uiMessage('replacement-user', 'user', 'What happened next?'),
        uiMessage('replacement-assistant', 'assistant', 'The hidden state completed.'),
      ],
    })

    expect(resolved.map((message) => message.id)).toEqual([
      'visible-assistant',
      'replacement-user',
      'replacement-assistant',
    ])
  })

  it('does not merge a disjoint active transcript into a current selected workspace', () => {
    const selectedNode = sessionNode(
      'selected-branch-assistant',
      null,
      'assistant',
      'Selected branch',
      0,
    )
    const branchHead = sessionNode(
      'later-branch-assistant',
      'selected-branch-assistant',
      'assistant',
      'Later branch answer',
      1,
    )

    const resolved = resolveTranscriptMessages({
      activeSessionId: SESSION_DETAIL_ID,
      activeSessionUpdatedAt: 10,
      activeWorkspace: workspaceWithPath(
        [selectedNode, branchHead],
        selectedNode.id,
        branchHead.id,
        4,
      ),
      messages: [
        uiMessage('other-branch-user', 'user', 'Other branch'),
        uiMessage('other-branch-assistant', 'assistant', 'Other answer'),
      ],
    })

    expect(resolved.map((message) => message.id)).toEqual(['selected-branch-assistant'])
  })

  it('does not merge a disjoint active transcript at the head of an inactive branch', () => {
    const inactiveBranchHead = sessionNode(
      'inactive-branch-head',
      null,
      'assistant',
      'Inactive branch',
      0,
      INACTIVE_BRANCH_ID,
    )
    const sessionHead = sessionNode('session-head', null, 'assistant', 'Current session head', 1)

    const resolved = resolveTranscriptMessages({
      activeSessionId: SESSION_DETAIL_ID,
      activeSessionUpdatedAt: 10,
      activeWorkspace: workspaceAtInactiveBranchHead(sessionHead, inactiveBranchHead),
      messages: [
        uiMessage('replacement-user', 'user', 'Current branch question'),
        uiMessage('replacement-assistant', 'assistant', 'Current branch answer'),
      ],
    })

    expect(resolved.map((message) => message.id)).toEqual(['inactive-branch-head'])
  })
})
