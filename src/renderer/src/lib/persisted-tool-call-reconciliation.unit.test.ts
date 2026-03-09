import { ConversationId, MessageId, ToolCallId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { describe, expect, it } from 'vitest'
import {
  buildPersistedToolCallLookup,
  restorePersistedToolCallPart,
  type UIToolCallPart,
} from './persisted-tool-call-reconciliation'

function makePersistedConversation(): Conversation {
  return {
    id: ConversationId('conv-1'),
    title: 'Pending approval',
    projectPath: null,
    createdAt: 1,
    updatedAt: 2,
    messages: [
      {
        id: MessageId('msg-1'),
        role: 'assistant',
        createdAt: 2,
        parts: [
          {
            type: 'tool-call',
            toolCall: {
              id: ToolCallId('tool-persisted'),
              name: 'writeFile',
              args: { path: 'pending.txt', content: 'hello' },
              state: 'approval-requested',
              approval: {
                id: 'approval_tool-persisted',
                needsApproval: true,
              },
            },
          },
        ],
      },
    ],
  }
}

describe('restorePersistedToolCallPart', () => {
  it('restores approval metadata and state using stable argument matching', () => {
    const lookup = buildPersistedToolCallLookup(makePersistedConversation())
    const uiPart: UIToolCallPart = {
      type: 'tool-call',
      id: 'tool-shadow',
      name: 'writeFile',
      arguments: '{"path":"pending.txt","content":"hello"}',
      state: 'input-complete',
    }

    expect(restorePersistedToolCallPart(uiPart, lookup)).toEqual({
      type: 'tool-call',
      id: 'tool-shadow',
      name: 'writeFile',
      arguments: '{"path":"pending.txt","content":"hello"}',
      state: 'approval-requested',
      approval: {
        id: 'approval_tool-persisted',
        needsApproval: true,
      },
    })
  })

  it('returns the same reference when persisted metadata adds nothing new', () => {
    const lookup = buildPersistedToolCallLookup(makePersistedConversation())
    const uiPart: UIToolCallPart = {
      type: 'tool-call',
      id: 'tool-persisted',
      name: 'writeFile',
      arguments: '{"path":"pending.txt","content":"hello"}',
      state: 'approval-requested',
      approval: {
        id: 'approval_tool-persisted',
        needsApproval: true,
      },
    }

    expect(restorePersistedToolCallPart(uiPart, lookup)).toBe(uiPart)
  })
})
