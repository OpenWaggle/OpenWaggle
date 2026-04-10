import type { ProviderInfo } from '@shared/types/llm'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ipc', () => ({
  api: {},
}))

import { buildModelCatalogSet, pruneStaleEnabledModels } from '../provider-store'

const PROVIDER_MODELS: ProviderInfo[] = [
  {
    provider: 'anthropic',
    displayName: 'Anthropic',
    requiresApiKey: true,
    supportsBaseUrl: false,
    supportsSubscription: true,
    supportsDynamicModelFetch: false,
    models: [
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'anthropic' },
    ],
  },
  {
    provider: 'openai',
    displayName: 'OpenAI',
    requiresApiKey: true,
    supportsBaseUrl: false,
    supportsSubscription: true,
    supportsDynamicModelFetch: false,
    models: [{ id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini', provider: 'openai' }],
  },
]

describe('buildModelCatalogSet', () => {
  it('creates a set of provider:modelId keys', () => {
    const catalog = buildModelCatalogSet(PROVIDER_MODELS)

    expect(catalog.has('anthropic:claude-sonnet-4-5')).toBe(true)
    expect(catalog.has('anthropic:claude-opus-4-5')).toBe(true)
    expect(catalog.has('openai:gpt-4.1-mini')).toBe(true)
    expect(catalog.has('gemini:gemini-2.5-flash')).toBe(false)
  })

  it('trims model IDs', () => {
    const models: ProviderInfo[] = [
      {
        ...PROVIDER_MODELS[0],
        models: [{ id: '  claude-sonnet-4-5  ', name: 'Claude Sonnet 4.5', provider: 'anthropic' }],
      },
    ]
    const catalog = buildModelCatalogSet(models)
    expect(catalog.has('anthropic:claude-sonnet-4-5')).toBe(true)
  })
})

describe('pruneStaleEnabledModels', () => {
  const catalog = buildModelCatalogSet(PROVIDER_MODELS)

  it('returns null when no entries are stale', () => {
    const enabledModels = [
      'anthropic:api-key:claude-sonnet-4-5',
      'openai:subscription:gpt-4.1-mini',
    ]
    expect(pruneStaleEnabledModels(enabledModels, catalog)).toBeNull()
  })

  it('removes stale entries with outdated model IDs', () => {
    const enabledModels = [
      'anthropic:api-key:claude-sonnet-4-5',
      'anthropic:api-key:claude-opus-4-5-20251101', // stale version suffix
    ]
    const result = pruneStaleEnabledModels(enabledModels, catalog)
    expect(result).toEqual(['anthropic:api-key:claude-sonnet-4-5'])
  })

  it('removes legacy bare model IDs', () => {
    const enabledModels = [
      'gpt-5.4', // legacy bare ID
      'gpt-5.3-codex', // legacy bare ID
      'anthropic:api-key:claude-sonnet-4-5',
    ]
    const result = pruneStaleEnabledModels(enabledModels, catalog)
    expect(result).toEqual(['anthropic:api-key:claude-sonnet-4-5'])
  })

  it('removes entries for models not in any provider', () => {
    const enabledModels = [
      'gemini:api-key:gemini-2.5-flash', // gemini not in catalog
      'anthropic:api-key:claude-sonnet-4-5',
    ]
    const result = pruneStaleEnabledModels(enabledModels, catalog)
    expect(result).toEqual(['anthropic:api-key:claude-sonnet-4-5'])
  })

  it('returns empty array when all entries are stale', () => {
    const enabledModels = ['gpt-5.4', 'anthropic:api-key:claude-opus-4-5-20251101']
    const result = pruneStaleEnabledModels(enabledModels, catalog)
    expect(result).toEqual([])
  })

  it('handles empty enabledModels', () => {
    expect(pruneStaleEnabledModels([], catalog)).toBeNull()
  })
})
