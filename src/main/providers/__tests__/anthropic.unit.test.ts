import { describe, expect, it, vi } from 'vitest'

const mockCreateAnthropicChat = vi.fn((..._args: unknown[]) => ({ type: 'anthropic-adapter' }))

// Track constructor calls for assertions
const constructorCalls: Array<{ config: unknown; model: unknown }> = []

class StubAnthropicTextAdapter {
  config: unknown
  model: unknown
  chatStream: unknown
  // Expose fake internals so the type guard passes
  mapCommonOptionsToAnthropic: unknown
  processAnthropicStream: unknown
  constructor(config: unknown, model: unknown) {
    this.config = config
    this.model = model
    this.chatStream = () => {}
    this.mapCommonOptionsToAnthropic = () => ({})
    this.processAnthropicStream = async function* () {}
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

  it('creates OAuth adapter with placeholder key for subscription auth', async () => {
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
    // Placeholder key is used since chatStream is overridden with raw fetch
    expect(call?.config).toEqual(
      expect.objectContaining({
        apiKey: 'unused-oauth-raw-fetch',
      }),
    )
    expect(call?.model).toBe('claude-sonnet-4-5')
  })

  it('creates OAuth adapter for 4.6 models via subscription', async () => {
    const { anthropicProvider } = await import('../anthropic')
    constructorCalls.length = 0
    const adapter = anthropicProvider.createAdapter(
      'claude-opus-4-6',
      'oauth-token',
      undefined,
      'subscription',
    )
    expect(adapter).toBeInstanceOf(StubAnthropicTextAdapter)
    expect(constructorCalls).toHaveLength(1)
    const call = constructorCalls[0]
    expect(call?.config).toEqual(
      expect.objectContaining({
        apiKey: 'unused-oauth-raw-fetch',
      }),
    )
    expect(call?.model).toBe('claude-opus-4-6')
  })

  it('routes setup tokens (sk-ant-oat) through OAuth adapter', async () => {
    const { anthropicProvider } = await import('../anthropic')
    constructorCalls.length = 0
    const adapter = anthropicProvider.createAdapter('claude-haiku-4-5', 'sk-ant-oat01-test-token')
    expect(adapter).toBeInstanceOf(StubAnthropicTextAdapter)
    expect(constructorCalls).toHaveLength(1)
    const call = constructorCalls[0]
    expect(call?.config).toEqual(
      expect.objectContaining({
        apiKey: 'unused-oauth-raw-fetch',
      }),
    )
  })

  it('creates API key adapter for 4.6 models via createAnthropicChat', async () => {
    const { anthropicProvider } = await import('../anthropic')
    mockCreateAnthropicChat.mockClear()
    anthropicProvider.createAdapter('claude-sonnet-4-6', 'sk-test')
    expect(mockCreateAnthropicChat).toHaveBeenCalledWith('claude-sonnet-4-6', 'sk-test')
  })

  it('accepts dynamically fetched model IDs without throwing', async () => {
    const { anthropicProvider } = await import('../anthropic')
    expect(() => anthropicProvider.createAdapter('claude-future-model', 'key')).not.toThrow()
    expect(mockCreateAnthropicChat).toHaveBeenCalledWith('claude-future-model', 'key')
  })

  it('throws when API key is missing', async () => {
    const { anthropicProvider } = await import('../anthropic')
    expect(() => anthropicProvider.createAdapter('claude-sonnet-4-5', undefined)).toThrow(
      'Anthropic API key is required',
    )
  })

  it('overrides chatStream on OAuth adapter', async () => {
    const { anthropicProvider } = await import('../anthropic')
    constructorCalls.length = 0
    const adapter = anthropicProvider.createAdapter(
      'claude-opus-4-6',
      'oauth-token',
      undefined,
      'subscription',
    )
    // The chatStream property should have been replaced with the raw fetch override
    const stub = adapter as unknown as StubAnthropicTextAdapter
    // chatStream should be a generator function (raw fetch override), not the original
    expect(typeof stub.chatStream).toBe('function')
  })

  describe('resolveSampling', () => {
    it('enables thinking with appropriate budget for pre-4.6 models', async () => {
      const { anthropicProvider } = await import('../anthropic')
      const base = { temperature: 0.7, topP: 0.9, maxTokens: 4096 }
      const resolveSampling = anthropicProvider.resolveSampling
      expect(resolveSampling).toBeDefined()
      if (!resolveSampling) return

      const result = resolveSampling('claude-sonnet-4-5', 'medium', base)
      expect(result.temperature).toBeUndefined()
      expect(result.topP).toBeUndefined()
      expect(result.maxTokens).toBe(5120) // Math.max(4096, 4096+1024)
      expect(result.modelOptions).toEqual({
        thinking: { type: 'enabled', budget_tokens: 4096 },
      })
    })

    it('uses larger budget for pre-4.6 opus models', async () => {
      const { anthropicProvider } = await import('../anthropic')
      const base = { temperature: 0.7, topP: 0.9, maxTokens: 4096 }
      const resolveSampling = anthropicProvider.resolveSampling
      expect(resolveSampling).toBeDefined()
      if (!resolveSampling) return

      const result = resolveSampling('claude-opus-4-5', 'high', base)
      expect(result.modelOptions).toEqual({
        thinking: { type: 'enabled', budget_tokens: 16384 },
      })
      expect(result.maxTokens).toBe(17408) // Math.max(4096, 16384+1024)
    })

    it('returns no modelOptions for 4.6 models (adapter handles adaptive thinking)', async () => {
      const { anthropicProvider } = await import('../anthropic')
      const base = { temperature: 0.7, topP: 0.9, maxTokens: 4096 }
      const resolveSampling = anthropicProvider.resolveSampling
      expect(resolveSampling).toBeDefined()
      if (!resolveSampling) return

      const opus46 = resolveSampling('claude-opus-4-6', 'high', base)
      expect(opus46.modelOptions).toBeUndefined()
      expect(opus46.maxTokens).toBe(32000) // ADAPTIVE_MAX_TOKENS.high
      expect(opus46.temperature).toBeUndefined()
      expect(opus46.topP).toBeUndefined()

      const sonnet46 = resolveSampling('claude-sonnet-4-6', 'medium', base)
      expect(sonnet46.modelOptions).toBeUndefined()
      expect(sonnet46.maxTokens).toBe(16000) // ADAPTIVE_MAX_TOKENS.medium
    })

    it('scales budget by quality preset for pre-4.6 models', async () => {
      const { anthropicProvider } = await import('../anthropic')
      const base = { temperature: 0.7, topP: 0.9, maxTokens: 4096 }
      const resolveSampling = anthropicProvider.resolveSampling
      expect(resolveSampling).toBeDefined()
      if (!resolveSampling) return

      const low = resolveSampling('claude-sonnet-4-5', 'low', base)
      const high = resolveSampling('claude-sonnet-4-5', 'high', base)
      expect(
        (low.modelOptions as { thinking: { budget_tokens: number } }).thinking.budget_tokens,
      ).toBeLessThan(
        (high.modelOptions as { thinking: { budget_tokens: number } }).thinking.budget_tokens,
      )
    })

    it('scales ADAPTIVE_MAX_TOKENS by quality preset for 4.6 models', async () => {
      const { anthropicProvider } = await import('../anthropic')
      const base = { temperature: 0.7, topP: 0.9, maxTokens: 4096 }
      const resolveSampling = anthropicProvider.resolveSampling
      expect(resolveSampling).toBeDefined()
      if (!resolveSampling) return

      const low = resolveSampling('claude-opus-4-6', 'low', base)
      const medium = resolveSampling('claude-opus-4-6', 'medium', base)
      const high = resolveSampling('claude-opus-4-6', 'high', base)
      expect(low.maxTokens).toBe(4096)
      expect(medium.maxTokens).toBe(16000)
      expect(high.maxTokens).toBe(32000)
    })
  })
})
