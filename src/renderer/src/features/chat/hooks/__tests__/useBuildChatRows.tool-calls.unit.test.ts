import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import {
  createAssistantPendingToolMessage,
  createAssistantTerminalToolMessage,
  createAssistantToolMessage,
  createToolResultMessage,
  createUserMessage,
  getAssistantMessageRows,
  getWaggleTurnRows,
  type WaggleMessageMetadata,
} from './useBuildChatRows.test-utils'

describe('buildChatRows tool-call rendering', () => {
  it('renders repeated Pi tool calls within the same user turn', () => {
    const messages: UIMessage[] = [
      createUserMessage('user-1', 'run command'),
      createAssistantToolMessage('assistant-1', 'tool-a'),
      createAssistantToolMessage('assistant-2', 'tool-b'),
    ]

    const assistantRows = getAssistantMessageRows(messages)
    expect(assistantRows).toHaveLength(2)
  })

  it('visually nests first-class tool-result messages under their matching assistant tool call', () => {
    const messages: UIMessage[] = [
      createUserMessage('user-1', 'run command'),
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-a',
            name: 'bash',
            arguments: '{"command":"echo hello"}',
            state: 'input-complete',
          },
        ],
      },
      createToolResultMessage('tool-result-1', 'tool-a'),
    ]

    const assistantRows = getAssistantMessageRows(messages)

    expect(assistantRows).toHaveLength(1)
    expect(assistantRows[0]?.message.parts).toMatchObject([
      { type: 'tool-call', id: 'tool-a' },
      {
        type: 'tool-result',
        toolCallId: 'tool-a',
        state: 'complete',
        sourceMessageId: 'tool-result-1',
      },
    ])
  })

  it('leaves out a message of Worker waits, its nested result included', () => {
    const waitMessage: UIMessage = {
      id: 'assistant-wait',
      role: 'assistant',
      parts: [
        {
          type: 'tool-call',
          id: 'wait-1',
          name: 'sessions',
          arguments: '{"action":"wait","sessionIds":["w1"]}',
          state: 'input-complete',
        },
      ],
    }
    const messages: UIMessage[] = [
      createUserMessage('user-1', 'coordinate'),
      createAssistantToolMessage('assistant-1', 'tool-a'),
      waitMessage,
      createToolResultMessage('wait-result', 'wait-1'),
    ]

    const assistantRows = getAssistantMessageRows(messages)

    expect(assistantRows.map((row) => row.message.id)).toEqual(['assistant-1'])
  })

  it('keeps a failed Waggle response whose only call is a hidden wait, so its turn shows it', () => {
    const failed: UIMessage = {
      id: 'assistant-failed',
      role: 'assistant',
      metadata: { error: 'provider overloaded' },
      parts: [
        {
          type: 'tool-call',
          id: 'wait-1',
          name: 'sessions',
          arguments: '{"action":"wait"}',
          state: 'input-complete',
        },
      ],
    }
    const messages = [createUserMessage('user-1', 'coordinate'), failed]

    const waggleRows = getWaggleTurnRows(messages, {
      'assistant-failed': {
        agentIndex: 0,
        agentLabel: 'Advocate',
        agentColor: 'blue',
        turnNumber: 0,
      },
    })
    expect(waggleRows.map((row) => row.messages.map((item) => item.message.id))).toEqual([
      ['assistant-failed'],
    ])
    // Outside Waggle the failure shows in the Run error row; the empty message row is dropped.
    expect(getAssistantMessageRows(messages)).toEqual([])
  })

  it('keeps repeated tool calls when they belong to different user turns', () => {
    const messages: UIMessage[] = [
      createUserMessage('user-1', 'run command'),
      createAssistantToolMessage('assistant-1', 'tool-a'),
      createUserMessage('user-2', 'run command again'),
      createAssistantToolMessage('assistant-2', 'tool-b'),
    ]

    const assistantRows = getAssistantMessageRows(messages)
    expect(assistantRows).toHaveLength(2)
  })

  it('keeps repeated tool calls when waggle turn metadata indicates different turns', () => {
    const messages: UIMessage[] = [
      createUserMessage('user-1', 'run command'),
      createAssistantToolMessage('assistant-turn-0', 'tool-a'),
      createAssistantToolMessage('assistant-turn-1', 'tool-b'),
    ]
    const waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>> = {
      'assistant-turn-0': {
        agentIndex: 0,
        agentLabel: 'Advocate',
        agentColor: 'blue',
        turnNumber: 0,
      },
      'assistant-turn-1': {
        agentIndex: 1,
        agentLabel: 'Critic',
        agentColor: 'amber',
        turnNumber: 1,
      },
    }

    const waggleRows = getWaggleTurnRows(messages, waggleMetadataLookup)
    expect(waggleRows).toHaveLength(2)
    expect(waggleRows[0]?.messages).toHaveLength(1)
    expect(waggleRows[1]?.messages).toHaveLength(1)
  })

  it('renders pending and terminal repeated tool rows independently', () => {
    const messages: UIMessage[] = [
      createUserMessage('user-1', 'create the file'),
      createAssistantPendingToolMessage('assistant-1', 'tool-a', "I'll create that file for you."),
      createAssistantTerminalToolMessage(
        'assistant-2',
        'tool-a',
        'The file write completed successfully.',
      ),
    ]

    const assistantRows = getAssistantMessageRows(messages, {}, new Set(['user-1']))
    expect(assistantRows).toHaveLength(2)

    const firstAssistantParts = assistantRows[0].message.parts
    expect(firstAssistantParts).toHaveLength(2)
    expect(firstAssistantParts[0]).toMatchObject({
      type: 'text',
      content: "I'll create that file for you.",
    })
    expect(firstAssistantParts[1]).toMatchObject({
      type: 'tool-call',
      name: 'write',
      state: 'input-complete',
    })

    const secondAssistantParts = assistantRows[1].message.parts
    expect(secondAssistantParts).toHaveLength(3)
    expect(secondAssistantParts[0]).toMatchObject({
      type: 'tool-call',
      name: 'write',
      state: 'output-available',
    })
    expect(secondAssistantParts[1]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'tool-a',
      state: 'output-available',
    })
    expect(secondAssistantParts[2]).toMatchObject({
      type: 'text',
      content: 'The file write completed successfully.',
    })
  })
})

// ─── Compaction summaries ───────────────────────────────────────────
