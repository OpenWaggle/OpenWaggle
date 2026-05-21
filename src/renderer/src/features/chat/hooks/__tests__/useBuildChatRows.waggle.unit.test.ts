import { describe, expect, it } from 'vitest'
import {
  buildChatRows,
  createAssistantToolMessage,
  createUserMessage,
  type UIMessage,
  type WaggleMessageMetadata,
} from './useBuildChatRows.test-utils'

describe('buildChatRows waggle message metadata', () => {
  const ADVOCATE_META: WaggleMessageMetadata = {
    agentIndex: 0,
    agentLabel: 'Advocate',
    agentColor: 'blue',
    turnNumber: 0,
  }

  const DEFAULT_PHASE = { current: null, completed: [], totalElapsedMs: 0 }

  it('groups explicit Waggle message metadata into one row per turn', () => {
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
      sessionId: 'session-waggle',
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

    const waggleRows = rows.filter((r) => r.type === 'waggle-turn')
    expect(waggleRows).toHaveLength(2)
    expect(waggleRows[0]?.messages).toHaveLength(1)
    expect(waggleRows[0]?.turnDividerProps).toMatchObject({
      agentLabel: 'Advocate',
      agentColor: 'blue',
      turnNumber: 0,
    })
    expect(waggleRows[1]?.messages).toHaveLength(1)
    expect(waggleRows[1]?.turnDividerProps).toMatchObject({
      agentLabel: 'Critic',
      agentColor: 'amber',
      turnNumber: 1,
    })
  })

  it('keeps one continuous Waggle turn row for multiple Pi message nodes in the same turn', () => {
    const messages = [
      createUserMessage('user-1', 'question'),
      createAssistantToolMessage('waggle-tool-a', 'tool-a'),
      createAssistantToolMessage('waggle-tool-b', 'tool-b'),
      {
        id: 'waggle-final',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, content: 'Final turn answer' }],
      },
    ]

    const rows = buildChatRows({
      messages,
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      sessionId: 'session-waggle',
      waggleMetadataLookup: {
        'waggle-tool-a': ADVOCATE_META,
        'waggle-tool-b': ADVOCATE_META,
        'waggle-final': ADVOCATE_META,
      },
      phase: DEFAULT_PHASE,
    })

    const waggleRows = rows.filter((r) => r.type === 'waggle-turn')
    expect(waggleRows).toHaveLength(1)
    expect(waggleRows[0]?.messages.map((row) => row.message.id)).toEqual([
      'waggle-tool-a',
      'waggle-tool-b',
      'waggle-final',
    ])
  })

  it('keeps fallback live metadata in the same turn when only one message has session id', () => {
    const messages = [
      createUserMessage('user-1', 'question'),
      createAssistantToolMessage('waggle-tool-a', 'tool-a'),
      createAssistantToolMessage('waggle-tool-b', 'tool-b'),
    ]

    const rows = buildChatRows({
      messages,
      isLoading: true,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      sessionId: 'session-waggle',
      waggleMetadataLookup: {
        'waggle-tool-a': ADVOCATE_META,
        'waggle-tool-b': { ...ADVOCATE_META, sessionId: 'session-waggle' },
      },
      phase: DEFAULT_PHASE,
    })

    const waggleRows = rows.filter((r) => r.type === 'waggle-turn')
    expect(waggleRows).toHaveLength(1)
    expect(waggleRows[0]?.messages.map((row) => row.message.id)).toEqual([
      'waggle-tool-a',
      'waggle-tool-b',
    ])
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
      sessionId: 'session-waggle',

      // Only the waggle message has metadata, not the post-waggle one
      waggleMetadataLookup: { 'waggle-msg': ADVOCATE_META },
      phase: DEFAULT_PHASE,
    })

    const waggleRows = rows.filter((r) => r.type === 'waggle-turn')
    const messageRows = rows.filter((r) => r.type === 'message' && r.message.role === 'assistant')
    expect(waggleRows).toHaveLength(1)
    expect(messageRows).toHaveLength(1)

    // Post-waggle message should have no waggle styling
    expect(messageRows[0]?.waggle).toBeUndefined()
    expect(messageRows[0]?.showTurnDivider).toBe(false)
  })
})
