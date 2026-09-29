import { describe, expect, it } from 'vitest'
import { createOptimisticUserMessage } from '../chat-attachment-preview'
import {
  isOptimisticUserMessageId,
  pendingSendAfter,
  pendingSentRowKey,
} from '../optimistic-user-message'

describe('isOptimisticUserMessageId', () => {
  it('recognises the optimistic copy of a send and nothing else', () => {
    const optimistic = createOptimisticUserMessage({
      text: 'Fix this layout',
      thinkingLevel: 'medium',
      attachments: [],
    })
    expect(isOptimisticUserMessageId(optimistic.id)).toBe(true)
    expect(isOptimisticUserMessageId('durable-message')).toBe(false)
    expect(isOptimisticUserMessageId('optimistic-steer-1')).toBe(false)
  })
})

describe('pendingSentRowKey', () => {
  const pending = { afterUserMessageId: 'optimistic-user-1' }

  it('is the latest user row once it is an optimistic message newer than the send baseline', () => {
    expect(pendingSentRowKey(pending, 'optimistic-user-2')).toBe('message:optimistic-user-2')
  })

  it('is nothing while no send is pending, before its row, or for a persisted message', () => {
    expect(pendingSentRowKey(null, 'optimistic-user-2')).toBeNull()
    expect(pendingSentRowKey(pending, 'optimistic-user-1')).toBeNull()
    expect(pendingSentRowKey(pending, 'durable-message')).toBeNull()
  })
})

describe('pendingSendAfter', () => {
  it('records the latest user message when the send begins', () => {
    const user = (id: string) => ({ id, role: 'user' as const, parts: [] })
    const answer = { id: 'a1', role: 'assistant' as const, parts: [] }
    expect(pendingSendAfter([user('u0'), user('u1'), answer])).toEqual({ afterUserMessageId: 'u1' })
    expect(pendingSendAfter([])).toEqual({ afterUserMessageId: null })
  })
})
