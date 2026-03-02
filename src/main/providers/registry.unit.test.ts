import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderDefinition } from './provider-definition'

function createProvider(
  id: ProviderDefinition['id'],
  models: readonly string[],
): ProviderDefinition {
  return {
    id,
    displayName: `Provider ${id}`,
    requiresApiKey: true,
    supportsBaseUrl: false,
    supportsSubscription: false,
    supportsDynamicModelFetch: false,
    models,
    testModel: models[0] ?? 'fallback-model',
    supportsAttachment: () => false,
    createAdapter: () => ({}) as never,
  }
}

describe('providerRegistry', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('registers providers and resolves model ownership', async () => {
    const { providerRegistry } = await import('./registry')
    const openai = createProvider('openai', ['gpt-4.1-mini'])
    const anthropic = createProvider('anthropic', ['claude-sonnet-4-5'])

    providerRegistry.register(openai)
    providerRegistry.register(anthropic)

    expect(providerRegistry.get('openai')).toEqual(openai)
    expect(providerRegistry.getProviderForModel('claude-sonnet-4-5')).toEqual(anthropic)
    expect(providerRegistry.isKnownModel('unknown-model')).toBe(false)
  })

  it('skips duplicate registrations with a warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { providerRegistry } = await import('./registry')
    const provider = createProvider('openai', ['gpt-4.1-mini'])

    providerRegistry.register(provider)
    providerRegistry.register(provider)

    expect(providerRegistry.getAll()).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('resolves models across multiple providers in O(1)', async () => {
    const { providerRegistry } = await import('./registry')
    const openai = createProvider('openai', ['gpt-4.1-mini', 'gpt-5'])
    const anthropic = createProvider('anthropic', ['claude-sonnet-4-5', 'claude-opus-4-6'])
    const gemini = createProvider('gemini', ['gemini-2.5-flash', 'gemini-2.5-pro'])

    providerRegistry.register(openai)
    providerRegistry.register(anthropic)
    providerRegistry.register(gemini)

    // Each model resolves to its correct provider
    expect(providerRegistry.getProviderForModel('gpt-4.1-mini')?.id).toBe('openai')
    expect(providerRegistry.getProviderForModel('gpt-5')?.id).toBe('openai')
    expect(providerRegistry.getProviderForModel('claude-sonnet-4-5')?.id).toBe('anthropic')
    expect(providerRegistry.getProviderForModel('claude-opus-4-6')?.id).toBe('anthropic')
    expect(providerRegistry.getProviderForModel('gemini-2.5-flash')?.id).toBe('gemini')
    expect(providerRegistry.getProviderForModel('gemini-2.5-pro')?.id).toBe('gemini')

    // Unknown models return undefined
    expect(providerRegistry.getProviderForModel('llama-3')).toBeUndefined()

    // isKnownModel uses the same index
    expect(providerRegistry.isKnownModel('gpt-5')).toBe(true)
    expect(providerRegistry.isKnownModel('nonexistent')).toBe(false)
  })
})
