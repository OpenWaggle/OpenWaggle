import { MessageId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionNode, SessionWorkspace } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { getVisibleForkTargets } from '../session-fork-targets'

const SESSION_ID = SessionId('session-1')

function node(id: string, role: 'user' | 'assistant', text: string): SessionNode {
  return {
    id: SessionNodeId(id),
    sessionId: SESSION_ID,
    parentId: null,
    piEntryType: 'message',
    kind: role === 'user' ? 'user_message' : 'assistant_message',
    role,
    timestampMs: 1,
    createdOrder: 1,
    pathDepth: 0,
    message: {
      id: MessageId(id),
      role,
      parts: [{ type: 'text', text }],
      createdAt: 1,
    },
    contentJson: '{}',
    metadataJson: '{}',
  }
}

function workspace(nodes: readonly SessionNode[]): SessionWorkspace {
  return {
    tree: {
      session: {
        id: SESSION_ID,
        title: 'Session',
        projectPath: '/tmp/project',
        createdAt: 1,
        updatedAt: 1,
      },
      nodes,
      branches: [],
      branchStates: [],
      uiState: null,
    },
    activeBranchId: null,
    activeNodeId: nodes[nodes.length - 1]?.id ?? null,
    transcriptPath: nodes.map((item) => ({ node: item, isActive: false })),
  }
}

describe('getVisibleForkTargets', () => {
  it('returns only visible user message nodes with text', () => {
    const targets = getVisibleForkTargets(
      workspace([
        node('user-1', 'user', 'Initial request'),
        node('assistant-1', 'assistant', 'Answer'),
        node('user-2', 'user', 'Follow-up'),
      ]),
    )

    expect(targets).toEqual([
      { entryId: SessionNodeId('user-2'), text: 'Follow-up' },
      { entryId: SessionNodeId('user-1'), text: 'Initial request' },
    ])
  })
})
