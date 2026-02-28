import { describe, expect, it } from 'vitest'
import { isSubscriptionProvider } from './auth'

describe('isSubscriptionProvider', () => {
  it('returns true for valid subscription providers', () => {
    expect(isSubscriptionProvider('openrouter')).toBe(true)
    expect(isSubscriptionProvider('openai')).toBe(true)
    expect(isSubscriptionProvider('anthropic')).toBe(true)
  })

  it('returns false for non-subscription providers', () => {
    expect(isSubscriptionProvider('gemini')).toBe(false)
    expect(isSubscriptionProvider('ollama')).toBe(false)
    expect(isSubscriptionProvider('grok')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isSubscriptionProvider('')).toBe(false)
  })

  it('returns false for arbitrary strings', () => {
    expect(isSubscriptionProvider('not-a-provider')).toBe(false)
    expect(isSubscriptionProvider('OPENAI')).toBe(false)
    expect(isSubscriptionProvider('Anthropic')).toBe(false)
  })
})
