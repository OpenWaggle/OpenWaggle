import { MessageId, type SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'

export function userNode(id: string, sessionId: SessionId): SessionNode {
  return {
    id: SessionNodeId(id),
    sessionId,
    parentId: null,
    piEntryType: 'message',
    kind: 'user_message',
    role: 'user',
    timestampMs: 1,
    createdOrder: 4,
    pathDepth: 0,
    message: {
      id: MessageId(id),
      role: 'user',
      parts: [{ type: 'text', text: 'Retry me' }],
      createdAt: 1,
    },
    contentJson: '{}',
    metadataJson: '{}',
  }
}

export function assistantNode(id: string, sessionId: SessionId): SessionNode {
  return {
    ...userNode(id, sessionId),
    kind: 'assistant_message',
    role: 'assistant',
    message: {
      id: MessageId(id),
      role: 'assistant',
      parts: [{ type: 'text', text: 'Here is the answer' }],
      createdAt: 2,
    },
  }
}
