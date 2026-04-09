import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnyTextAdapter } from '@tanstack/ai'
import type { ProviderDefinition } from '../provider-definition'

function stubTextAdapter(): AnyTextAdapter {
  return {
    kind: 'text',
    name: 'stub',
    model: 'stub-model',
    '~types': {
      providerOptions: {},
      inputModalities: [],
      messageMetadataByModality: {},
    },
    chatStream: () => (async function* () {})(),
    structuredOutput: () => Promise.resolve({ data: null, rawText: '' }),
  }
}

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
    createAdapter: () => stubTextAdapter(),
  }
}

describe('providerRegistry', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('registers providers and resolves model ownership', async () => {
    const { providerRegistry } = await import('../registry')
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
    const { providerRegistry } = await import('../registry')
    const provider = createProvider('openai', ['gpt-4.1-mini'])

    providerRegistry.register(provider)
    providerRegistry.register(provider)

    expect(providerRegistry.getAll()).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('resolves models across multiple providers in O(1)', async () => {
    const { providerRegistry } = await import('../registry')
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

  it('indexes dynamically discovered models for an existing provider', async () => {
    const { providerRegistry } = await import('../registry')
    const openai = createProvider('openai', ['gpt-4.1-mini'])

    providerRegistry.register(openai)

    // gpt-5.4 is a subscription-only model not in the static list
    expect(providerRegistry.isKnownModel('gpt-5.4')).toBe(false)

    providerRegistry.indexModels(['gpt-5.4', 'gpt-5.3-codex'], openai)

    expect(providerRegistry.isKnownModel('gpt-5.4')).toBe(true)
    expect(providerRegistry.getProviderForModel('gpt-5.4')?.id).toBe('openai')
    expect(providerRegistry.isKnownModel('gpt-5.3-codex')).toBe(true)
    expect(providerRegistry.getProviderForModel('gpt-5.3-codex')?.id).toBe('openai')
  })

  it('does not overwrite existing model ownership when indexing', async () => {
    const { providerRegistry } = await import('../registry')
    const openai = createProvider('openai', ['gpt-4.1-mini'])
    const openrouter = createProvider('openrouter', [])

    providerRegistry.register(openai)
    providerRegistry.register(openrouter)

    // Index the same model for a different provider — should not overwrite
    providerRegistry.indexModels(['gpt-4.1-mini'], openrouter)

    expect(providerRegistry.getProviderForModel('gpt-4.1-mini')?.id).toBe('openai')
  })
})
