import { CONTEXT_WINDOW } from '@shared/constants/context-config'
import { describe, expect, it } from 'vitest'
import { anthropicProvider } from '../anthropic'
import { geminiProvider } from '../gemini'
import { grokProvider } from '../grok'
import { ollamaProvider } from '../ollama'
import { openaiProvider } from '../openai'
import { openrouterProvider } from '../openrouter'

describe('getContextWindow', () => {
  describe('anthropic', () => {
    it('returns 1M context for Claude Opus 4.6', () => {
      const result = anthropicProvider.getContextWindow?.('claude-opus-4-6')
      expect(result).toEqual({ contextTokens: 1_000_000, maxOutputTokens: 128_000 })
    })

    it('returns 1M context for Claude Sonnet 4.6', () => {
      const result = anthropicProvider.getContextWindow?.('claude-sonnet-4-6')
      expect(result).toEqual({ contextTokens: 1_000_000, maxOutputTokens: 64_000 })
    })

    it('returns 200K context for Claude Sonnet 4.5', () => {
      const result = anthropicProvider.getContextWindow?.('claude-sonnet-4-5')
      expect(result).toEqual({ contextTokens: 200_000, maxOutputTokens: 64_000 })
    })

    it('returns 200K context for Claude Haiku', () => {
      const result = anthropicProvider.getContextWindow?.('claude-haiku-4-5')
      expect(result).toEqual({ contextTokens: 200_000, maxOutputTokens: 64_000 })
    })

    it('returns a default for unknown Anthropic models', () => {
      const result = anthropicProvider.getContextWindow?.('claude-unknown-99')
      expect(result).toBeDefined()
      expect(result?.contextTokens).toBe(200_000)
    })
  })

  describe('openai', () => {
    it('returns 272K context for GPT-5.4', () => {
      const result = openaiProvider.getContextWindow?.('gpt-5.4')
      expect(result).toEqual({ contextTokens: 272_000, maxOutputTokens: 128_000 })
    })

    it('returns 128K context for GPT-5.3-codex-spark', () => {
      const result = openaiProvider.getContextWindow?.('gpt-5.3-codex-spark')
      expect(result).toEqual({ contextTokens: 128_000, maxOutputTokens: 128_000 })
    })

    it('returns 200K for o-series reasoning models', () => {
      const result = openaiProvider.getContextWindow?.('o3')
      expect(result).toEqual({ contextTokens: 200_000, maxOutputTokens: 100_000 })
    })

    it('returns 128K for GPT-4 family', () => {
      const result = openaiProvider.getContextWindow?.('gpt-4.1-nano')
      expect(result).toEqual({ contextTokens: 128_000, maxOutputTokens: 128_000 })
    })

    it('returns undefined for unknown models', () => {
      const result = openaiProvider.getContextWindow?.('unknown-model')
      expect(result).toBeUndefined()
    })
  })

  describe('gemini', () => {
    it('returns 1M context for Gemini 2.5 Pro', () => {
      const result = geminiProvider.getContextWindow?.('gemini-2.5-pro')
      expect(result?.contextTokens).toBe(1_000_000)
    })

    it('returns 1M context for Gemini 2.0 Flash', () => {
      const result = geminiProvider.getContextWindow?.('gemini-2.0-flash-lite')
      expect(result?.contextTokens).toBe(1_000_000)
    })
  })

  describe('grok', () => {
    it('returns 131K context for Grok models', () => {
      const result = grokProvider.getContextWindow?.('grok-3-mini-fast')
      expect(result).toEqual({ contextTokens: 131_072, maxOutputTokens: 131_072 })
    })

    it('returns undefined for non-grok models', () => {
      const result = grokProvider.getContextWindow?.('unknown')
      expect(result).toBeUndefined()
    })
  })

  describe('providers without context windows', () => {
    it('openrouter does not define getContextWindow', () => {
      expect(openrouterProvider.getContextWindow).toBeUndefined()
    })

    it('ollama does not define getContextWindow', () => {
      expect(ollamaProvider.getContextWindow).toBeUndefined()
    })
  })

  describe('CONTEXT_WINDOW.DEFAULT_TOKENS', () => {
    it('is 128K as a safe fallback', () => {
      expect(CONTEXT_WINDOW.DEFAULT_TOKENS).toBe(128_000)
    })
  })
})
