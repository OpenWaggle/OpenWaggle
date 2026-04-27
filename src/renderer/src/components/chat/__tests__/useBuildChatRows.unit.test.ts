import { SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
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
        name: 'bash',
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

function createToolResultMessage(id: string, toolCallId: string): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      {
        type: 'tool-result',
        toolCallId,
        content: { kind: 'text', text: 'hello' },
        state: 'complete',
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
        name: 'write',
        arguments: '{"path":"pending-reload-check.txt","content":"reload should not fake success"}',
        state: 'input-complete',
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
        name: 'write',
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

function getAssistantMessageRows(
  messages: UIMessage[],
  waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>> = {},
) {
  const rows = buildChatRows({
    messages,
    isLoading: false,
    error: undefined,
    lastUserMessage: null,
    dismissedError: null,
    conversationId: 'conv-rows',
    model: SupportedModelId('gpt-5-mini'),

    waggleMetadataLookup,
    phase: { current: null, completed: [], totalElapsedMs: 0 },
  })

  return rows.filter(
    (row): row is Extract<(typeof rows)[number], { type: 'message' }> =>
      row.type === 'message' && row.message.role === 'assistant',
  )
}

describe('buildChatRows tool-call rendering', () => {
  it('renders repeated Pi tool calls within the same user turn', () => {
    const messages = [
      createUserMessage('user-1', 'run command'),
      createAssistantToolMessage('assistant-1', 'tool-a'),
      createAssistantToolMessage('assistant-2', 'tool-b'),
    ]

    const assistantRows = getAssistantMessageRows(messages)
    expect(assistantRows).toHaveLength(2)
  })

  it('visually nests first-class tool-result messages under their matching assistant tool call', () => {
    const messages = [
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
      { type: 'tool-result', toolCallId: 'tool-a', state: 'complete' },
    ])
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

  it('keeps repeated tool calls when waggle turn metadata indicates different turns', () => {
    const messages = [
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

    const assistantRows = getAssistantMessageRows(messages, waggleMetadataLookup)
    expect(assistantRows).toHaveLength(2)
  })

  it('renders pending and terminal repeated tool rows independently', () => {
    const messages = [
      createUserMessage('user-1', 'create the file'),
      createAssistantPendingToolMessage('assistant-1', 'tool-a', "I'll create that file for you."),
      createAssistantTerminalToolMessage(
        'assistant-2',
        'tool-a',
        'The file write completed successfully.',
      ),
    ]

    const assistantRows = getAssistantMessageRows(messages)
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

describe('buildChatRows compaction summaries', () => {
  it('turns compaction summary messages into dedicated summary rows', () => {
    const compactionMessage: UIMessage = {
      id: 'compaction-summary',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Compaction summary\n\nKept the failing test context.' }],
      metadata: {
        compactionSummary: {
          summary: 'Kept the failing test context.',
          tokensBefore: 123456,
        },
      },
    }

    const rows = buildChatRows({
      messages: [createUserMessage('user-1', 'compact'), compactionMessage],
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      conversationId: 'conv-compaction',
      model: SupportedModelId('gpt-5-mini'),
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
    })

    expect(rows.map((row) => row.type)).toEqual(['message', 'compaction-summary'])
    expect(rows[1]).toMatchObject({
      type: 'compaction-summary',
      id: 'compaction-summary',
      summary: 'Kept the failing test context.',
      tokensBefore: 123456,
    })
  })
})

// ─── isRunActive propagation ────────────────────────────────────────

describe('buildChatRows reasoning visibility', () => {
  it('keeps assistant rows that contain inline reasoning content', () => {
    const rows = buildChatRows({
      messages: [
        createUserMessage('user-1', 'think first'),
        {
          id: 'assistant-reasoning',
          role: 'assistant',
          parts: [{ type: 'thinking', content: 'Planning the next tool call.' }],
        },
      ],
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      conversationId: 'conv-reasoning',
      model: SupportedModelId('gpt-5-mini'),
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
    })

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { type: 'message' }> =>
        row.type === 'message' && row.message.role === 'assistant',
    )

    expect(assistantRows).toHaveLength(1)
    expect(assistantRows[0]?.message.parts).toEqual([
      {
        type: 'thinking',
        content: 'Planning the next tool call.',
      },
    ])
  })
})

describe('buildChatRows isRunActive', () => {
  it('sets isRunActive on the last assistant row when isLoading is true', () => {
    const messages = [
      createUserMessage('user-1', 'hello'),
      {
        id: 'assistant-1',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, content: 'first reply' }],
      },
      {
        id: 'assistant-2',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, content: 'second reply' }],
      },
    ]

    const rows = buildChatRows({
      messages,
      isLoading: true,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      conversationId: 'conv-active',
      model: SupportedModelId('gpt-5-mini'),
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
    })

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { type: 'message' }> =>
        row.type === 'message' && row.message.role === 'assistant',
    )

    // All assistant rows in an active run should have isRunActive true
    for (const row of assistantRows) {
      expect(row.isRunActive).toBe(true)
    }
  })

  it('sets isRunActive to false when isLoading is false', () => {
    const messages = [
      createUserMessage('user-1', 'hello'),
      {
        id: 'assistant-1',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, content: 'reply' }],
      },
    ]

    const rows = buildChatRows({
      messages,
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      conversationId: 'conv-inactive',
      model: SupportedModelId('gpt-5-mini'),
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
    })

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { type: 'message' }> =>
        row.type === 'message' && row.message.role === 'assistant',
    )

    for (const row of assistantRows) {
      expect(row.isRunActive).toBe(false)
    }
  })
})

// ─── Waggle message metadata tests ────────────────────────────────

describe('buildChatRows waggle message metadata', () => {
  const ADVOCATE_META: WaggleMessageMetadata = {
    agentIndex: 0,
    agentLabel: 'Advocate',
    agentColor: 'blue',
    turnNumber: 0,
  }

  const DEFAULT_PHASE = { current: null, completed: [], totalElapsedMs: 0 }

  it('shows turn dividers from explicit Waggle message metadata', () => {
    const advocateMsg: UIMessage = {
      id: 'waggle-advocate',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Advocate analysis' }],
    }
    const criticMsg: UIMessage = {
      id: 'waggle-critic',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Critic response' }],
    }

    const rows = buildChatRows({
      messages: [createUserMessage('user-1', 'question'), advocateMsg, criticMsg],
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      conversationId: 'conv-waggle',
      model: SupportedModelId('claude-sonnet-4-6'),
      waggleMetadataLookup: {
        'waggle-advocate': ADVOCATE_META,
        'waggle-critic': {
          agentIndex: 1,
          agentLabel: 'Critic',
          agentColor: 'amber',
          turnNumber: 1,
        },
      },
      phase: DEFAULT_PHASE,
    })

    const messageRows = rows.filter((r) => r.type === 'message' && r.message.role === 'assistant')
    expect(messageRows).toHaveLength(2)
    expect(messageRows[0].showTurnDivider).toBe(true)
    expect(messageRows[0].turnDividerProps).toMatchObject({
      agentLabel: 'Advocate',
      agentColor: 'blue',
      turnNumber: 0,
    })
    expect(messageRows[1].showTurnDivider).toBe(true)
    expect(messageRows[1].turnDividerProps).toMatchObject({
      agentLabel: 'Critic',
      agentColor: 'amber',
      turnNumber: 1,
    })
  })

  it('renders post-waggle messages without waggle styling', () => {
    const waggleMsg: UIMessage = {
      id: 'waggle-msg',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Debate content' }],
    }
    const postWaggleMsg: UIMessage = {
      id: 'post-waggle-msg',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Standard response' }],
    }

    const rows = buildChatRows({
      messages: [createUserMessage('user-1', 'question'), waggleMsg, postWaggleMsg],
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      conversationId: 'conv-waggle',
      model: SupportedModelId('claude-sonnet-4-6'),

      // Only the waggle message has metadata, not the post-waggle one
      waggleMetadataLookup: { 'waggle-msg': ADVOCATE_META },
      phase: DEFAULT_PHASE,
    })

    const messageRows = rows.filter((r) => r.type === 'message' && r.message.role === 'assistant')
    expect(messageRows).toHaveLength(2)

    // Post-waggle message should have no waggle styling
    expect(messageRows[1].waggle).toBeUndefined()
    expect(messageRows[1].showTurnDivider).toBe(false)
  })
})
