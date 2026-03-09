import { describe, expect, it, vi } from 'vitest'

const mockCreateAnthropicChat = vi.fn((..._args: unknown[]) => ({ type: 'anthropic-adapter' }))

// Track constructor calls for assertions
const constructorCalls: Array<{ config: unknown; model: unknown }> = []

class StubAnthropicTextAdapter {
  config: unknown
  model: unknown
  constructor(config: unknown, model: unknown) {
    this.config = config
    this.model = model
    constructorCalls.push({ config, model })
  }
}

vi.mock('@tanstack/ai-anthropic', () => ({
  ANTHROPIC_MODELS: ['claude-sonnet-4-5', 'claude-opus-4', 'claude-haiku-4-5'] as const,
  createAnthropicChat: (...args: unknown[]) => mockCreateAnthropicChat(...args),
  AnthropicTextAdapter: StubAnthropicTextAdapter,
}))

describe('anthropicProvider', () => {
  it('creates adapter for known model with API key', async () => {
    const { anthropicProvider } = await import('../anthropic')
    anthropicProvider.createAdapter('claude-sonnet-4-5', 'sk-test')
    expect(mockCreateAnthropicChat).toHaveBeenCalledWith('claude-sonnet-4-5', 'sk-test')
  })

  it('creates subscription adapter with authToken', async () => {
    const { anthropicProvider } = await import('../anthropic')
    constructorCalls.length = 0
    const adapter = anthropicProvider.createAdapter(
      'claude-sonnet-4-5',
      'oauth-token',
      undefined,
      'subscription',
    )
    expect(adapter).toBeInstanceOf(StubAnthropicTextAdapter)
    expect(constructorCalls).toHaveLength(1)
    const call = constructorCalls[0]
    expect(call?.config).toEqual(
      expect.objectContaining({
        apiKey: '',
        authToken: 'oauth-token',
      }),
    )
    expect(call?.model).toBe('claude-sonnet-4-5')
  })

  it('throws for unknown model', async () => {
    const { anthropicProvider } = await import('../anthropic')
    expect(() => anthropicProvider.createAdapter('unknown', 'key')).toThrow(
      'Unknown Anthropic model',
    )
  })

  it('throws when API key is missing', async () => {
    const { anthropicProvider } = await import('../anthropic')
    expect(() => anthropicProvider.createAdapter('claude-sonnet-4-5', undefined)).toThrow(
      'Anthropic API key is required',
    )
  })

  describe('resolveSampling', () => {
    it('enables thinking with appropriate budget for non-opus models', async () => {
      const { anthropicProvider } = await import('../anthropic')
      const base = { temperature: 0.7, topP: 0.9, maxTokens: 4096 }
      const resolveSampling = anthropicProvider.resolveSampling
      expect(resolveSampling).toBeDefined()
      if (!resolveSampling) return

      const result = resolveSampling('claude-sonnet-4-5', 'medium', base)
      expect(result.temperature).toBeUndefined()
      expect(result.topP).toBeUndefined()
      expect(result.maxTokens).toBe(8192) // Math.max(4096, 8192)
      expect(result.modelOptions).toEqual({
        thinking: { type: 'enabled', budget_tokens: 4096 },
      })
    })

    it('uses higher budget for opus models', async () => {
      const { anthropicProvider } = await import('../anthropic')
      const base = { temperature: 0.7, topP: 0.9, maxTokens: 4096 }
      const resolveSampling = anthropicProvider.resolveSampling
      expect(resolveSampling).toBeDefined()
      if (!resolveSampling) return

      const result = resolveSampling('claude-opus-4', 'high', base)
      expect(result.modelOptions).toEqual({
        thinking: { type: 'enabled', budget_tokens: 16384 },
      })
    })

    it('scales budget by quality preset', async () => {
      const { anthropicProvider } = await import('../anthropic')
      const base = { temperature: 0.7, topP: 0.9, maxTokens: 4096 }
      const resolveSampling = anthropicProvider.resolveSampling
      expect(resolveSampling).toBeDefined()
      if (!resolveSampling) return

      const low = resolveSampling('claude-sonnet-4-5', 'low', base)
      const high = resolveSampling('claude-sonnet-4-5', 'high', base)

      const lowBudget = (low.modelOptions as Record<string, Record<string, number>>).thinking
        .budget_tokens
      const highBudget = (high.modelOptions as Record<string, Record<string, number>>).thinking
        .budget_tokens
      expect(highBudget).toBeGreaterThan(lowBudget)
    })
  })
})
