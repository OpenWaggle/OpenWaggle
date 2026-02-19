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
    models,
    testModel: models[0] ?? 'fallback-model',
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
})
