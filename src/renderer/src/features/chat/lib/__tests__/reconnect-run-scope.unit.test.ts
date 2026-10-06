import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { reconnectedRunScope } from '../reconnect-run-scope'
import { withoutSavedRunAnswers } from '../saved-run-answers'

function user(id: string, order: number): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content: id }],
    metadata: { sessionNodeCreatedOrder: order },
  }
}

function answer(id: string, order?: number): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', content: 'x' }],
    ...(order === undefined ? {} : { metadata: { sessionNodeCreatedOrder: order } }),
  }
}

const SNAPSHOT: BackgroundRunSnapshot = {
  activity: 'agent-run',
  sessionId: SessionId('session-1'),
  model: SupportedModelId('claude-sonnet-4-5'),
  mode: 'classic',
  startedAt: 1_000,
  activityEvents: [],
  messageId: 'assistant-live',
  parts: [],
}

describe('reconnectedRunScope', () => {
  const persistedMessages = [user('n-u1', 1)]

  it('starts a Run without a buffer at its first user row not persisted', () => {
    const currentMessages = [user('n-u1', 1), user('live-u2', 4), user('live-u3', 6)]
    expect(reconnectedRunScope({ snapshot: null, persistedMessages, currentMessages })).toEqual({
      fromOrder: 4,
    })
  })

  it('skips a persisted prompt that kept its optimistic id: it is an earlier Run', () => {
    expect(
      reconnectedRunScope({
        snapshot: null,
        persistedMessages: [...persistedMessages, answer('n-a1', 2)],
        currentMessages: [user('optimistic-u1', 1), answer('n-a1', 2), user('live-u2', 4)],
      }),
    ).toEqual({ fromOrder: 4 })
  })

  it('starts at the reconnected Run own saved prompt, whose answers show under stream ids', () => {
    const saved = [...persistedMessages, answer('n-a1', 2), user('n-u2', 4), answer('n-a2', 5)]
    const currentMessages = [
      user('n-u1', 1),
      answer('n-a1', 2),
      user('live-u2', 4),
      answer('stream-a2'),
    ]
    const scope = reconnectedRunScope({
      snapshot: null,
      persistedMessages: saved,
      currentMessages,
    })
    expect(scope).toEqual({ fromOrder: 4 })
    // The stream copy of the saved answer is left to it, not shown twice.
    const shownIds = new Set(currentMessages.map((message) => message.id))
    const kept = withoutSavedRunAnswers(currentMessages, saved, { shownIds, ...scope })
    expect(kept.map((message) => message.id)).toEqual(['n-u1', 'n-a1', 'live-u2'])
  })

  it('keeps a live answer after a user row the saved transcript lacks, though its text is saved', () => {
    const saved = [...persistedMessages, answer('n-a1', 2)]
    const currentMessages = [user('n-u1', 1), user('live-u2', 4), answer('stream-a2')]
    const kept = withoutSavedRunAnswers(currentMessages, saved, { fromOrder: 1 })
    expect(kept.map((message) => message.id)).toEqual(['n-u1', 'live-u2', 'stream-a2'])
    // Before that row, the same answer is the saved one's stream copy.
    const copy = withoutSavedRunAnswers([user('n-u1', 1), answer('stream-a1')], saved, {
      fromOrder: 1,
    })
    expect(copy.map((message) => message.id)).toEqual(['n-u1'])
  })

  it('scopes no answer when the transcript shows no such row', () => {
    expect(
      reconnectedRunScope({
        snapshot: null,
        persistedMessages,
        currentMessages: [user('n-u1', 1)],
      }),
    ).toEqual({ fromOrder: Number.POSITIVE_INFINITY })
  })

  it('scopes by the buffer read before the detail when the Run settled before the next read', () => {
    const settledBuffer: BackgroundRunSnapshot = {
      ...SNAPSHOT,
      userMessages: [
        { messageId: 'live-u2', parts: [], sessionNodeCreatedOrder: 4, timestamp: 1_500 },
      ],
    }
    expect(
      reconnectedRunScope({
        snapshot: null,
        settledBuffer,
        persistedMessages,
        currentMessages: [user('n-u1', 1)],
      }),
    ).toEqual({ fromOrder: 4 })
  })

  it('scopes a buffer that retains no user messages from the Run start by Host time', () => {
    const scope = { snapshot: SNAPSHOT, persistedMessages, currentMessages: [] }
    expect(reconnectedRunScope(scope)).toEqual({
      fromTime: 1_000,
    })
  })
})
