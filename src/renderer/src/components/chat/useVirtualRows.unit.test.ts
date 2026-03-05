import { SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@tanstack/ai-react'
import { describe, expect, it } from 'vitest'
import { buildVirtualRows } from './useVirtualRows'

function createUserMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content: text }],
  }
}

function createAssistantToolMessage(id: string, toolCallId: string): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      {
        type: 'tool-call',
        id: toolCallId,
        name: 'runCommand',
        arguments: '{"command":"echo hello"}',
        state: 'output-available',
      },
      {
        type: 'tool-result',
        toolCallId,
        output: { kind: 'text', text: 'hello' },
        state: 'output-available',
      },
    ],
  }
}

function getAssistantMessageRows(messages: UIMessage[]) {
  const rows = buildVirtualRows({
    messages,
    isLoading: false,
    error: undefined,
    lastUserMessage: null,
    dismissedError: null,
    conversationId: 'conv-rows',
    model: SupportedModelId('gpt-5-mini'),
    messageModelLookup: {},
    waggleMetadataLookup: {},
    phase: { current: null, completed: [], totalElapsedMs: 0 },
  })

  return rows.filter(
    (row): row is Extract<(typeof rows)[number], { type: 'message' }> =>
      row.type === 'message' && row.message.role === 'assistant',
  )
}

describe('buildVirtualRows tool-call dedup', () => {
  it('deduplicates repeated tool calls within the same user turn', () => {
    const messages = [
      createUserMessage('user-1', 'run command'),
      createAssistantToolMessage('assistant-1', 'tool-a'),
      createAssistantToolMessage('assistant-2', 'tool-b'),
    ]

    const assistantRows = getAssistantMessageRows(messages)
    expect(assistantRows).toHaveLength(1)
  })

  it('keeps repeated tool calls when they belong to different user turns', () => {
    const messages = [
      createUserMessage('user-1', 'run command'),
      createAssistantToolMessage('assistant-1', 'tool-a'),
      createUserMessage('user-2', 'run command again'),
      createAssistantToolMessage('assistant-2', 'tool-b'),
    ]

    const assistantRows = getAssistantMessageRows(messages)
    expect(assistantRows).toHaveLength(2)
  })
})
