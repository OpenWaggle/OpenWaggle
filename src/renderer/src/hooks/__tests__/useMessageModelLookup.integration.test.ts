import type { Message } from '@shared/types/agent'
import { MessageId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { describe, expect, it } from 'vitest'
import { useMessageModelLookup } from '../useMessageModelLookup'

function makeConversation(messages: Message[]): Conversation {
  return {
    id: 'conv-1' as ReturnType<typeof import('@shared/types/brand').ConversationId>,
    title: 'Test',
    projectPath: null,
    messages,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('useMessageModelLookup', () => {
  it('builds lookup from assistant messages with model', () => {
    const conv = makeConversation([
      { id: MessageId('msg-1'), role: 'user', parts: [{ type: 'text', text: 'hi' }], createdAt: 1 },
      {
        id: MessageId('msg-2'),
        role: 'assistant',
        parts: [{ type: 'text', text: 'hello' }],
        model: 'claude-3-5-sonnet-20241022',
        createdAt: 2,
      },
      {
        id: MessageId('msg-3'),
        role: 'assistant',
        parts: [{ type: 'text', text: 'bye' }],
        createdAt: 3,
      },
      {
        id: MessageId('msg-4'),
        role: 'assistant',
        parts: [{ type: 'text', text: 'ok' }],
        model: 'gpt-4o',
        createdAt: 4,
      },
    ] as Message[])

    const lookup = useMessageModelLookup(conv)

    expect(lookup).toEqual({
      'msg-2': 'claude-3-5-sonnet-20241022',
      'msg-4': 'gpt-4o',
    })
  })

  it('returns empty object for null conversation', () => {
    expect(useMessageModelLookup(null)).toEqual({})
  })

  it('returns empty object for conversation with no assistant messages', () => {
    const conv = makeConversation([
      { id: MessageId('msg-1'), role: 'user', parts: [{ type: 'text', text: 'hi' }], createdAt: 1 },
    ] as Message[])

    expect(useMessageModelLookup(conv)).toEqual({})
  })
})
