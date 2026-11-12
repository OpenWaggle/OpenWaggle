import { MessageId, SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionNode } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { resolveTranscriptMessages } from '../session-workspace-transcript'
import {
  INACTIVE_BRANCH_ID,
  workspaceAtInactiveBranchHead,
} from './session-workspace-transcript.fixtures'
import { required } from '@/test-utils/required'

const SESSION_ID = SessionId('session-1')

function assistantNode(id: string, content: string, createdOrder: number): SessionNode {
  return {
    id: SessionNodeId(id),
    sessionId: SESSION_ID,
    parentId: null,
    piEntryType: 'message',
    kind: 'assistant_message',
    role: 'assistant',
    timestampMs: createdOrder + 1,
    createdOrder,
    pathDepth: createdOrder,
    branchId: createdOrder === 0 ? INACTIVE_BRANCH_ID : SessionBranchId('session-1:main'),
    message: {
      id: MessageId(id),
      role: 'assistant',
      parts: [{ type: 'text', text: content }],
      createdAt: createdOrder + 1,
    },
    contentJson: JSON.stringify({ parts: [{ type: 'text', text: content }], model: null }),
    metadataJson: '{}',
  }
}

function uiMessage(id: string, role: 'user' | 'assistant', content: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content }],
    createdAt: new Date(1),
  }
}

describe('resolveTranscriptMessages at an inactive branch head', () => {
  it('does not merge a disjoint active transcript', () => {
    const inactiveBranchHead = assistantNode('inactive-branch-head', 'Inactive branch', 0)
    const sessionHead = assistantNode('session-head', 'Current session head', 1)

    const resolved = resolveTranscriptMessages({
      activeSessionId: SESSION_ID,
      activeSessionUpdatedAt: 10,
      activeWorkspace: workspaceAtInactiveBranchHead(sessionHead, inactiveBranchHead),
      messages: [
        uiMessage('replacement-user', 'user', 'Current branch question'),
        uiMessage('replacement-assistant', 'assistant', 'Current branch answer'),
      ],
    })

    expect(resolved.map((message) => message.id)).toEqual(['inactive-branch-head'])
  })

  it('keeps the error of a failed response at the branch head', () => {
    const failedHead = assistantNode('inactive-branch-head', '', 0)
    const inactiveBranchHead: SessionNode = {
      ...failedHead,
      message: {
        ...required(failedHead.message),
        parts: [],
        metadata: { error: '401 Unauthorized' },
      },
    }
    const sessionHead = assistantNode('session-head', 'Current session head', 1)

    const resolved = resolveTranscriptMessages({
      activeSessionId: SESSION_ID,
      activeSessionUpdatedAt: 10,
      activeWorkspace: workspaceAtInactiveBranchHead(sessionHead, inactiveBranchHead),
      messages: [],
    })

    expect(resolved[0]?.metadata?.error).toBe('401 Unauthorized')
  })

  // The row the Host wrote to start a Run for worker updates never reads as the user's.
  it('keeps the Host marks of a row on another branch', () => {
    const wakeNode = assistantNode('inactive-branch-head', 'Worker updates arrived', 0)
    const inactiveBranchHead: SessionNode = {
      ...wakeNode,
      kind: 'user_message',
      role: 'user',
      message: {
        ...required(wakeNode.message),
        role: 'user',
        metadata: { hiveWake: true, scheduledTask: { taskId: 'task-1', name: 'Nightly triage' } },
      },
    }
    const sessionHead = assistantNode('session-head', 'Current session head', 1)

    const resolved = resolveTranscriptMessages({
      activeSessionId: SESSION_ID,
      activeSessionUpdatedAt: 10,
      activeWorkspace: workspaceAtInactiveBranchHead(sessionHead, inactiveBranchHead),
      messages: [],
    })

    expect(resolved[0]?.metadata).toMatchObject({
      hiveWake: true,
      scheduledTask: { taskId: 'task-1', name: 'Nightly triage' },
    })
  })
})
