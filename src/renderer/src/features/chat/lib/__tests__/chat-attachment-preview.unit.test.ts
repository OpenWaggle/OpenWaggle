import { describe, expect, it } from 'vitest'
import { createOptimisticUserMessage, isOptimisticUserMessageId } from '../chat-attachment-preview'

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
