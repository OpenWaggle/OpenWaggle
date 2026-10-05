import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { reconnectedRunStartOrder } from '../reconnect-run-scope'

function user(id: string, order: number): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content: id }],
    metadata: { sessionNodeCreatedOrder: order },
  }
}

describe('reconnectedRunStartOrder', () => {
  const persistedMessages = [user('n-u1', 1)]
  const currentMessages = [
    user('n-u1', 1),
    user('live-u1', 1),
    user('live-u2', 4),
    user('live-u3', 6),
  ]

  it('starts a Run without a buffer at its first user row not settled nor persisted', () => {
    expect(
      reconnectedRunStartOrder({
        snapshot: null,
        persistedMessages,
        currentMessages,
        settledMessageIds: new Set(['live-u1']),
      }),
    ).toBe(4)
  })

  it('scopes no answer when the transcript shows no such row', () => {
    expect(
      reconnectedRunStartOrder({
        snapshot: null,
        persistedMessages,
        currentMessages: [user('n-u1', 1)],
        settledMessageIds: undefined,
      }),
    ).toBe(Number.POSITIVE_INFINITY)
  })
})
