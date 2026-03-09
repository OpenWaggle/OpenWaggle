import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/ai-gemini', () => ({
  GeminiTextModels: ['gemini-2.0-flash-lite', 'gemini-2.5-pro'] as const,
  createGeminiChat: vi.fn(() => ({ type: 'gemini-adapter' })),
}))

describe('geminiProvider', () => {
  it('creates adapter for known model with valid API key', async () => {
    const { geminiProvider } = await import('../gemini')
    const { createGeminiChat } = await import('@tanstack/ai-gemini')
    const adapter = geminiProvider.createAdapter('gemini-2.0-flash-lite', 'test-key')
    expect(createGeminiChat).toHaveBeenCalledWith('gemini-2.0-flash-lite', 'test-key')
    expect(adapter).toEqual({ type: 'gemini-adapter' })
  })

  it('throws for unknown model', async () => {
    const { geminiProvider } = await import('../gemini')
    expect(() => geminiProvider.createAdapter('unknown-model', 'key')).toThrow(
      'Unknown Gemini model',
    )
  })

  it('throws when API key is missing', async () => {
    const { geminiProvider } = await import('../gemini')
    expect(() => geminiProvider.createAdapter('gemini-2.0-flash-lite', undefined)).toThrow(
      'Gemini API key is required',
    )
  })
})
