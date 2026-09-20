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
})
