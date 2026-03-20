import { SupportedModelId } from '@shared/types/brand'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
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
    messageModelLookup: {},
    waggleMetadataLookup,
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

// ─── Waggle segment tests ────────────────────────────────────────

function createBoundaryPart(meta: {
  agentIndex: number
  agentLabel: string
  agentColor: string
  turnNumber: number
  isSynthesis?: boolean
}): UIMessage['parts'][number] {
  const metaJson = JSON.stringify(meta)
  return {
    type: 'tool-call' as const,
    id: `boundary-${String(meta.turnNumber)}`,
    name: `_turnBoundary:${metaJson}`,
    arguments: metaJson,
    state: 'output-available' as const,
    output: metaJson,
  }
}

function createWaggleStreamingMessage(
  turnMetas: {
    agentIndex: number
    agentLabel: string
    agentColor: string
    turnNumber: number
    isSynthesis?: boolean
  }[],
): UIMessage {
  const parts: UIMessage['parts'] = []

  // First turn content (no boundary before it)
  parts.push({ type: 'text', content: 'Turn 0 response' })

  // Subsequent turns: boundary + content
  for (let i = 1; i < turnMetas.length; i++) {
    const meta = turnMetas[i]
    parts.push(createBoundaryPart(meta))
    parts.push({ type: 'text', content: `Turn ${String(i)} response` })
  }

  return { id: 'waggle-msg', role: 'assistant', parts }
}

describe('buildChatRows waggle segments', () => {
  const ADVOCATE_META: WaggleMessageMetadata = {
    agentIndex: 0,
    agentLabel: 'Advocate',
    agentColor: 'blue',
    turnNumber: 0,
  }

  const DEFAULT_PHASE = { current: null, completed: [], totalElapsedMs: 0 }

  it('shows a turn divider for the first segment (Turn 1)', () => {
    const msg = createWaggleStreamingMessage([
      { agentIndex: 0, agentLabel: 'Advocate', agentColor: 'blue', turnNumber: 0 },
      { agentIndex: 1, agentLabel: 'Critic', agentColor: 'amber', turnNumber: 1 },
    ])

    const rows = buildChatRows({
      messages: [createUserMessage('user-1', 'question'), msg],
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      conversationId: 'conv-waggle',
      model: SupportedModelId('claude-sonnet-4-6'),
      messageModelLookup: {},
      waggleMetadataLookup: { 'waggle-msg': ADVOCATE_META },
      phase: DEFAULT_PHASE,
    })

    const segmentRows = rows.filter((r) => r.type === 'segment')
    expect(segmentRows).toHaveLength(2)

    // First segment should have a divider
    expect(segmentRows[0].showDivider).toBe(true)
    expect(segmentRows[0].dividerProps).toMatchObject({
      agentLabel: 'Advocate',
      agentColor: 'blue',
      turnNumber: 0,
    })

    // Second segment should also have a divider (different agent)
    expect(segmentRows[1].showDivider).toBe(true)
    expect(segmentRows[1].dividerProps).toMatchObject({
      agentLabel: 'Critic',
      agentColor: 'amber',
      turnNumber: 1,
    })
  })

  it('assigns correct agent metadata to each segment from boundaries', () => {
    const msg = createWaggleStreamingMessage([
      { agentIndex: 0, agentLabel: 'Advocate', agentColor: 'blue', turnNumber: 0 },
      { agentIndex: 1, agentLabel: 'Critic', agentColor: 'amber', turnNumber: 1 },
      { agentIndex: 0, agentLabel: 'Advocate', agentColor: 'blue', turnNumber: 2 },
    ])

    const rows = buildChatRows({
      messages: [createUserMessage('user-1', 'question'), msg],
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      conversationId: 'conv-waggle',
      model: SupportedModelId('claude-sonnet-4-6'),
      messageModelLookup: {},
      waggleMetadataLookup: { 'waggle-msg': ADVOCATE_META },
      phase: DEFAULT_PHASE,
    })

    const segmentRows = rows.filter((r) => r.type === 'segment')
    expect(segmentRows).toHaveLength(3)

    expect(segmentRows[0].waggle).toMatchObject({ agentLabel: 'Advocate', agentColor: 'blue' })
    expect(segmentRows[1].waggle).toMatchObject({ agentLabel: 'Critic', agentColor: 'amber' })
    expect(segmentRows[2].waggle).toMatchObject({ agentLabel: 'Advocate', agentColor: 'blue' })
  })

  it('reads metadata from arguments when output is not yet available (live streaming)', () => {
    const criticMeta = {
      agentIndex: 1,
      agentLabel: 'Critic',
      agentColor: 'amber',
      turnNumber: 1,
    }
    // Simulate live streaming: boundary has metadata in tool name but no output yet
    const streamingBoundary: UIMessage['parts'][number] = {
      type: 'tool-call' as const,
      id: 'boundary-1',
      name: `_turnBoundary:${JSON.stringify(criticMeta)}`,
      arguments: '',
      state: 'streaming' as const,
      // output is undefined during streaming
    }
    const msg: UIMessage = {
      id: 'waggle-streaming',
      role: 'assistant',
      parts: [
        { type: 'text', content: 'Advocate analysis' },
        streamingBoundary,
        { type: 'text', content: 'Critic response' },
      ],
    }

    const rows = buildChatRows({
      messages: [createUserMessage('user-1', 'question'), msg],
      isLoading: true,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      conversationId: 'conv-waggle',
      model: SupportedModelId('claude-sonnet-4-6'),
      messageModelLookup: {},
      waggleMetadataLookup: { 'waggle-streaming': ADVOCATE_META },
      phase: DEFAULT_PHASE,
    })

    const segmentRows = rows.filter((r) => r.type === 'segment')
    expect(segmentRows).toHaveLength(2)

    // First segment: Advocate's content
    expect(segmentRows[0].waggle).toMatchObject({ agentLabel: 'Advocate', agentColor: 'blue' })
    // Second segment: Critic's content — metadata read from arguments, not output
    expect(segmentRows[1].waggle).toMatchObject({ agentLabel: 'Critic', agentColor: 'amber' })
  })

  it('renders post-waggle messages without waggle styling', () => {
    // A regular assistant message after waggle ends — no turn boundaries, no waggle metadata
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
      messageModelLookup: {},
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

  it('skips assistant rows that become empty after boundary cleanup', () => {
    const emptyBoundaryMeta = {
      agentIndex: 0,
      agentLabel: 'Advocate',
      agentColor: 'blue',
      turnNumber: 0,
    }
    const boundaryJson = JSON.stringify(emptyBoundaryMeta)
    const emptyBoundaryOnlyMessage: UIMessage = {
      id: 'assistant-empty-boundary',
      role: 'assistant',
      parts: [
        {
          type: 'tool-call',
          id: 'boundary-tool-id',
          name: `_turnBoundary:${boundaryJson}`,
          arguments: boundaryJson,
          state: 'output-available',
          output: boundaryJson,
        },
      ],
    }
    const realAssistantMessage: UIMessage = {
      id: 'assistant-visible',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Critic response' }],
    }

    const rows = buildChatRows({
      messages: [
        createUserMessage('user-1', 'question'),
        emptyBoundaryOnlyMessage,
        realAssistantMessage,
      ],
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      conversationId: 'conv-waggle',
      model: SupportedModelId('claude-sonnet-4-6'),
      messageModelLookup: {},
      waggleMetadataLookup: {
        'assistant-empty-boundary': {
          agentIndex: 0,
          agentLabel: 'Advocate',
          agentColor: 'blue',
          turnNumber: 0,
        },
        'assistant-visible': {
          agentIndex: 1,
          agentLabel: 'Critic',
          agentColor: 'amber',
          turnNumber: 1,
        },
      },
      phase: DEFAULT_PHASE,
    })

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { type: 'message' }> =>
        row.type === 'message' && row.message.role === 'assistant',
    )
    expect(assistantRows).toHaveLength(1)
    expect(assistantRows[0].message.id).toBe('assistant-visible')
  })
})
