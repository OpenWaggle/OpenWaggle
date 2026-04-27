import { SupportedModelId } from '@shared/types/brand'
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

    auth: {
      configured: true,
      source: 'api-key',
      apiKeyConfigured: true,
      apiKeySource: 'api-key',
      oauthConnected: false,
      supportsApiKey: true,
      supportsOAuth: true,
    },
    models: [
      {
        id: SupportedModelId('anthropic/claude-sonnet-4-5'),
        modelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        provider: 'anthropic',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
      },
      {
        id: SupportedModelId('anthropic/claude-opus-4-5'),
        modelId: 'claude-opus-4-5',
        name: 'Claude Opus 4.5',
        provider: 'anthropic',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
      },
    ],
  },
  {
    provider: 'openai',
    displayName: 'OpenAI',

    auth: {
      configured: true,
      source: 'api-key',
      apiKeyConfigured: true,
      apiKeySource: 'api-key',
      oauthConnected: false,
      supportsApiKey: true,
      supportsOAuth: true,
    },
    models: [
      {
        id: SupportedModelId('openai/gpt-4.1-mini'),
        modelId: 'gpt-4.1-mini',
        name: 'GPT 4.1 Mini',
        provider: 'openai',
        available: true,
        availableThinkingLevels: ['off'],
      },
    ],
  },
]

describe('buildModelCatalogSet', () => {
  it('creates a set of canonical provider/modelId refs', () => {
    const catalog = buildModelCatalogSet(PROVIDER_MODELS)

    expect(catalog.has('anthropic/claude-sonnet-4-5')).toBe(true)
    expect(catalog.has('anthropic/claude-opus-4-5')).toBe(true)
    expect(catalog.has('openai/gpt-4.1-mini')).toBe(true)
    expect(catalog.has('gemini/gemini-2.5-flash')).toBe(false)
  })

  it('trims model IDs', () => {
    const models: ProviderInfo[] = [
      {
        ...PROVIDER_MODELS[0],
        models: [
          {
            id: SupportedModelId('  anthropic/claude-sonnet-4-5  '),
            modelId: 'claude-sonnet-4-5',
            name: 'Claude Sonnet 4.5',
            provider: 'anthropic',
            available: true,
            availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
          },
        ],
      },
    ]
    const catalog = buildModelCatalogSet(models)
    expect(catalog.has('anthropic/claude-sonnet-4-5')).toBe(true)
  })
})

describe('pruneStaleEnabledModels', () => {
  const catalog = buildModelCatalogSet(PROVIDER_MODELS)

  it('returns null when no entries are stale', () => {
    const enabledModels = ['anthropic/claude-sonnet-4-5', 'openai/gpt-4.1-mini']
    expect(pruneStaleEnabledModels(enabledModels, catalog)).toBeNull()
  })

  it('removes stale entries with outdated model IDs', () => {
    const enabledModels = [
      'anthropic/claude-sonnet-4-5',
      'anthropic/claude-opus-4-5-20251101', // stale version suffix
    ]
    const result = pruneStaleEnabledModels(enabledModels, catalog)
    expect(result).toEqual(['anthropic/claude-sonnet-4-5'])
  })

  it('removes providerless model IDs', () => {
    const enabledModels = ['gpt-5.4', 'gpt-5.3-codex', 'anthropic/claude-sonnet-4-5']
    const result = pruneStaleEnabledModels(enabledModels, catalog)
    expect(result).toEqual(['anthropic/claude-sonnet-4-5'])
  })

  it('removes entries for models not in any provider', () => {
    const enabledModels = [
      'gemini/gemini-2.5-flash', // gemini not in catalog
      'anthropic/claude-sonnet-4-5',
    ]
    const result = pruneStaleEnabledModels(enabledModels, catalog)
    expect(result).toEqual(['anthropic/claude-sonnet-4-5'])
  })

  it('returns empty array when all entries are stale', () => {
    const enabledModels = ['gpt-5.4', 'anthropic/claude-opus-4-5-20251101']
    const result = pruneStaleEnabledModels(enabledModels, catalog)
    expect(result).toEqual([])
  })

  it('handles empty enabledModels', () => {
    expect(pruneStaleEnabledModels([], catalog)).toBeNull()
  })
})
