import { describe, expect, it } from 'vitest'
import { estimateMessagesTokens, estimateMessageTokens, estimateTokens } from '../token-estimation'

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('estimates 1 token per 4 characters', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2) // ceil(5/4) = 2
    expect(estimateTokens('abcdefgh')).toBe(2)
  })

  it('handles unicode characters', () => {
    // String.length counts UTF-16 code units, not chars
    const emoji = '🎉🎉🎉🎉' // 8 code units
    expect(estimateTokens(emoji)).toBe(2) // ceil(8/4) = 2
  })

  it('handles large strings', () => {
    const large = 'a'.repeat(100_000)
    expect(estimateTokens(large)).toBe(25_000)
  })
})

describe('estimateMessageTokens', () => {
  it('includes role overhead', () => {
    const msg = { role: 'user', content: '' }
    // 4 tokens for role overhead + 0 for empty content
    expect(estimateMessageTokens(msg)).toBe(4)
  })

  it('estimates string content', () => {
    const msg = { role: 'user', content: 'abcdefghijklmnop' } // 16 chars = 4 tokens
    expect(estimateMessageTokens(msg)).toBe(8) // 4 overhead + 4 content
  })

  it('handles null content', () => {
    const msg = { role: 'assistant', content: null }
    expect(estimateMessageTokens(msg)).toBe(4) // just overhead
  })

  it('handles array content with text parts', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'text', content: 'hello world!' }, // 12 chars = 3 tokens
      ],
    }
    expect(estimateMessageTokens(msg)).toBe(7) // 4 overhead + 3
  })

  it('includes tool call arguments', () => {
    const msg = {
      role: 'assistant',
      content: 'ok',
      toolCalls: [
        { function: { arguments: '{"path":"src/foo.ts"}' } }, // 21 chars = 6 tokens
      ],
    }
    // 4 overhead + 1 content ("ok" = ceil(2/4)) + 6 args
    expect(estimateMessageTokens(msg)).toBe(11)
  })

  it('includes toolCallId', () => {
    const msg = {
      role: 'tool',
      content: 'result',
      toolCallId: 'call_abc123def456', // 17 chars = 5 tokens
    }
    // 4 overhead + 2 content + 5 toolCallId
    expect(estimateMessageTokens(msg)).toBe(11)
  })
})

describe('estimateMessagesTokens', () => {
  it('sums token estimates across messages', () => {
    const messages = [
      { role: 'user', content: 'hello' }, // 4 + 2 = 6
      { role: 'assistant', content: 'world' }, // 4 + 2 = 6
    ]
    expect(estimateMessagesTokens(messages)).toBe(12)
  })

  it('returns 0 for empty array', () => {
    expect(estimateMessagesTokens([])).toBe(0)
  })
})
