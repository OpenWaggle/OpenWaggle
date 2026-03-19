import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/ai-openrouter', () => ({
  createOpenRouterText: vi.fn(() => ({ type: 'openrouter-adapter' })),
}))

describe('openrouterProvider', () => {
  it('has curated model list with known entries', async () => {
    const { openrouterProvider } = await import('../openrouter')
    expect(openrouterProvider.models.length).toBeGreaterThan(0)
    expect(openrouterProvider.models).toContain('openrouter/auto')
    expect(openrouterProvider.models).toContain('anthropic/claude-opus-4')
  })

  it('creates adapter for known model with valid API key', async () => {
    const { openrouterProvider } = await import('../openrouter')
    const { createOpenRouterText } = await import('@tanstack/ai-openrouter')
    openrouterProvider.createAdapter('openrouter/auto', 'test-key')
    expect(createOpenRouterText).toHaveBeenCalledWith('openrouter/auto', 'test-key')
  })

  it('accepts dynamically fetched model IDs without throwing', async () => {
    const { openrouterProvider } = await import('../openrouter')
    const { createOpenRouterText } = await import('@tanstack/ai-openrouter')
    expect(() => openrouterProvider.createAdapter('unknown/model', 'key')).not.toThrow()
    expect(createOpenRouterText).toHaveBeenCalledWith('unknown/model', 'key')
  })

  it('throws when API key is missing', async () => {
    const { openrouterProvider } = await import('../openrouter')
    expect(() => openrouterProvider.createAdapter('openrouter/auto', undefined)).toThrow(
      'OpenRouter API key is required',
    )
  })
})
