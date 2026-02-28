import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/ai-gemini', () => ({
  GeminiTextModels: ['gemini-2.0-flash-lite', 'gemini-2.5-pro'] as const,
  createGeminiChat: vi.fn(() => ({ type: 'gemini-adapter' })),
}))

describe('geminiProvider', () => {
  it('exports correct provider metadata', async () => {
    const { geminiProvider } = await import('./gemini')
    expect(geminiProvider.id).toBe('gemini')
    expect(geminiProvider.displayName).toBe('Gemini')
    expect(geminiProvider.requiresApiKey).toBe(true)
    expect(geminiProvider.supportsBaseUrl).toBe(false)
    expect(geminiProvider.supportsSubscription).toBe(false)
    expect(geminiProvider.supportsDynamicModelFetch).toBe(false)
    expect(geminiProvider.testModel).toBe('gemini-2.0-flash-lite')
  })

  it('creates adapter for known model with valid API key', async () => {
    const { geminiProvider } = await import('./gemini')
    const { createGeminiChat } = await import('@tanstack/ai-gemini')
    const adapter = geminiProvider.createAdapter('gemini-2.0-flash-lite', 'test-key')
    expect(createGeminiChat).toHaveBeenCalledWith('gemini-2.0-flash-lite', 'test-key')
    expect(adapter).toEqual({ type: 'gemini-adapter' })
  })

  it('throws for unknown model', async () => {
    const { geminiProvider } = await import('./gemini')
    expect(() => geminiProvider.createAdapter('unknown-model', 'key')).toThrow(
      'Unknown Gemini model',
    )
  })

  it('throws when API key is missing', async () => {
    const { geminiProvider } = await import('./gemini')
    expect(() => geminiProvider.createAdapter('gemini-2.0-flash-lite', undefined)).toThrow(
      'Gemini API key is required',
    )
  })
})
