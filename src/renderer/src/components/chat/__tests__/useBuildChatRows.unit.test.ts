import { SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@tanstack/ai-react'
import { describe, expect, it } from 'vitest'
import { buildChatRows } from '../useBuildChatRows'

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

function createAssistantPendingToolMessage(
  id: string,
  toolCallId: string,
  text: string,
): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      { type: 'text', content: text },
      {
        type: 'tool-call',
        id: toolCallId,
        name: 'writeFile',
        arguments: '{"path":"pending-reload-check.txt","content":"reload should not fake success"}',
        state: 'approval-requested',
      },
    ],
  }
}

function createAssistantTerminalToolMessage(
  id: string,
  toolCallId: string,
  text: string,
): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      {
        type: 'tool-call',
        id: toolCallId,
        name: 'writeFile',
        arguments: '{"path":"pending-reload-check.txt","content":"reload should not fake success"}',
        state: 'output-available',
      },
      {
        type: 'tool-result',
        toolCallId,
        output: { success: true, path: 'pending-reload-check.txt' },
        state: 'output-available',
      },
      { type: 'text', content: text },
    ],
  }
}

function getAssistantMessageRows(messages: UIMessage[]) {
  const rows = buildChatRows({
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

describe('buildChatRows tool-call dedup', () => {
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

  it('prefers the later terminal tool row over an earlier pending duplicate in the same user turn', () => {
    const messages = [
      createUserMessage('user-1', 'create the file'),
      createAssistantPendingToolMessage('assistant-1', 'tool-a', "I'll create that file for you."),
      createAssistantTerminalToolMessage(
        'assistant-2',
        'tool-a',
        'The file write has been approved and is pending execution.',
      ),
    ]

    const assistantRows = getAssistantMessageRows(messages)
    expect(assistantRows).toHaveLength(2)

    const firstAssistantParts = assistantRows[0].message.parts
    expect(firstAssistantParts).toHaveLength(1)
    expect(firstAssistantParts[0]).toMatchObject({
      type: 'text',
      content: "I'll create that file for you.",
    })

    const secondAssistantParts = assistantRows[1].message.parts
    expect(secondAssistantParts).toHaveLength(3)
    expect(secondAssistantParts[0]).toMatchObject({
      type: 'tool-call',
      name: 'writeFile',
      state: 'output-available',
    })
    expect(secondAssistantParts[1]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'tool-a',
      state: 'output-available',
    })
    expect(secondAssistantParts[2]).toMatchObject({
      type: 'text',
      content: 'The file write has been approved and is pending execution.',
    })
  })
})
