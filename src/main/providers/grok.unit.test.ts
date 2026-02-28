import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/ai-grok', () => ({
  GROK_CHAT_MODELS: ['grok-3-mini-fast', 'grok-3'] as const,
  createGrokText: vi.fn(() => ({ type: 'grok-adapter' })),
}))

describe('grokProvider', () => {
  it('exports correct provider metadata', async () => {
    const { grokProvider } = await import('./grok')
    expect(grokProvider.id).toBe('grok')
    expect(grokProvider.displayName).toBe('Grok')
    expect(grokProvider.requiresApiKey).toBe(true)
    expect(grokProvider.supportsBaseUrl).toBe(false)
    expect(grokProvider.supportsSubscription).toBe(false)
    expect(grokProvider.supportsDynamicModelFetch).toBe(false)
    expect(grokProvider.testModel).toBe('grok-3-mini-fast')
  })

  it('creates adapter for known model with valid API key', async () => {
    const { grokProvider } = await import('./grok')
    const { createGrokText } = await import('@tanstack/ai-grok')
    const adapter = grokProvider.createAdapter('grok-3-mini-fast', 'test-key')
    expect(createGrokText).toHaveBeenCalledWith('grok-3-mini-fast', 'test-key')
    expect(adapter).toEqual({ type: 'grok-adapter' })
  })

  it('throws for unknown model', async () => {
    const { grokProvider } = await import('./grok')
    expect(() => grokProvider.createAdapter('unknown-model', 'key')).toThrow('Unknown Grok model')
  })

  it('throws when API key is missing', async () => {
    const { grokProvider } = await import('./grok')
    expect(() => grokProvider.createAdapter('grok-3-mini-fast', undefined)).toThrow(
      'Grok API key is required',
    )
  })
})
