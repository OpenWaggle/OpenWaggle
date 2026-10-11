import { describe, expect, it } from 'vitest'
import type { WaggleTurnChatRow } from '../../lib/types-chat-row'
import {
  buildChatRows,
  createUserMessage,
  type UIMessage,
  type WaggleMessageMetadata,
} from './useBuildChatRows.test-utils'

const PHASE = { current: null, completed: [], totalElapsedMs: 0 }
const ADVOCATE: WaggleMessageMetadata = {
  agentIndex: 0,
  agentLabel: 'Advocate',
  agentColor: 'blue',
  turnNumber: 0,
}
const CRITIC: WaggleMessageMetadata = {
  agentIndex: 1,
  agentLabel: 'Critic',
  agentColor: 'amber',
  turnNumber: 1,
}

function answer(id: string, text: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', content: text }] }
}

function failed(id: string, error: string): UIMessage {
  return { id, role: 'assistant', parts: [], metadata: { error } }
}

function waggleTurns(input: {
  readonly messages: readonly UIMessage[]
  readonly lookup: Record<string, WaggleMessageMetadata>
  readonly error?: Error
  readonly dismissedError?: string
}) {
  return buildChatRows({
    messages: [createUserMessage('user-1', 'question'), ...input.messages],
    isLoading: false,
    error: input.error,
    lastUserMessage: 'question',
    dismissedError: input.dismissedError ?? null,
    sessionId: 'session-waggle',
    waggleMetadataLookup: input.lookup,
    phase: PHASE,
  }).filter((row): row is WaggleTurnChatRow => row.type === 'waggle-turn')
}

describe('buildChatRows failed Waggle turns', () => {
  it("marks a turn whose last response failed with that response's error", () => {
    const turns = waggleTurns({
      messages: [answer('a-1', 'Advocate answer'), failed('c-1', '401 Unauthorized')],
      lookup: { 'a-1': ADVOCATE, 'c-1': CRITIC },
    })

    expect(turns.map((turn) => turn.failure)).toEqual([undefined, '401 Unauthorized'])
  })

  it('does not mark a turn Pi retried and then answered', () => {
    const turns = waggleTurns({
      messages: [failed('c-1', '503 Service Unavailable'), answer('c-2', 'Critic answer')],
      lookup: { 'c-1': CRITIC, 'c-2': CRITIC },
    })

    expect(turns).toHaveLength(1)
    expect(turns[0]?.failure).toBeUndefined()
  })

  it("leaves the last failed turn's error to the Run error row while it shows", () => {
    const turns = waggleTurns({
      messages: [failed('a-1', '503 Service Unavailable'), failed('c-1', '401 Unauthorized')],
      lookup: { 'a-1': ADVOCATE, 'c-1': CRITIC },
      error: new Error('401 Unauthorized'),
    })

    expect(turns.map((turn) => turn.failure)).toEqual(['503 Service Unavailable', undefined])
  })

  it('marks the last failed turn again once the Run error is dismissed', () => {
    const turns = waggleTurns({
      messages: [failed('c-1', '401 Unauthorized')],
      lookup: { 'c-1': CRITIC },
      error: new Error('401 Unauthorized'),
      dismissedError: '401 Unauthorized',
    })

    expect(turns[0]?.failure).toBe('401 Unauthorized')
  })
})
