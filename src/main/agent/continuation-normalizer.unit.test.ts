import type { ModelMessage, UIMessage } from '@tanstack/ai'
import { describe, expect, it } from 'vitest'
import { normalizeContinuationInput } from './continuation-normalizer'

function makeUiTextMessage(id: string, role: UIMessage['role'], content: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content }],
  }
}

function makeToolCall(id: string): NonNullable<ModelMessage['toolCalls']>[number] {
  return {
    id,
    type: 'function',
    function: {
      name: 'writeFile',
      arguments: '{"path":"a.txt"}',
    },
  }
}

describe('normalizeContinuationInput', () => {
  it('drops system UI snapshot messages instead of remapping them to user role', () => {
    const input: Array<ModelMessage | UIMessage> = [
      makeUiTextMessage('sys-1', 'system', 'internal instruction'),
      makeUiTextMessage('user-1', 'user', 'hello'),
    ]

    const normalized = normalizeContinuationInput(input)

    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toMatchObject({
      role: 'user',
      content: 'hello',
    })
  })

  it('dedupes repeated assistant tool calls but preserves assistant text content', () => {
    const repeatedToolCall = makeToolCall('tool-1')
    const input: Array<ModelMessage | UIMessage> = [
      { role: 'assistant', content: null, toolCalls: [repeatedToolCall] },
      {
        role: 'assistant',
        content: 'still waiting',
        toolCalls: [repeatedToolCall],
      },
    ]

    const normalized = normalizeContinuationInput(input)

    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toMatchObject({
      role: 'assistant',
      content: 'still waiting',
      toolCalls: [repeatedToolCall],
    })
  })
})
