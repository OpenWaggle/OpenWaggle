import { describe, expect, it } from 'vitest'
import { AUTH_METHODS, isSubscriptionProvider, SUBSCRIPTION_PROVIDERS } from './auth'

describe('auth type constants', () => {
  describe('SUBSCRIPTION_PROVIDERS', () => {
    it('contains expected providers', () => {
      expect(SUBSCRIPTION_PROVIDERS).toContain('openrouter')
      expect(SUBSCRIPTION_PROVIDERS).toContain('openai')
      expect(SUBSCRIPTION_PROVIDERS).toContain('anthropic')
    })

    it('has exactly 3 providers', () => {
      expect(SUBSCRIPTION_PROVIDERS).toHaveLength(3)
    })
  })

  describe('AUTH_METHODS', () => {
    it('contains api-key and subscription', () => {
      expect(AUTH_METHODS).toContain('api-key')
      expect(AUTH_METHODS).toContain('subscription')
    })

    it('has exactly 2 methods', () => {
      expect(AUTH_METHODS).toHaveLength(2)
    })
  })
})

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
