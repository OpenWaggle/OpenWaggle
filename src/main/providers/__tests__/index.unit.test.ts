import type { Provider } from '@shared/types/settings'
import type { AnyTextAdapter } from '@tanstack/ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderDefinition } from '../provider-definition'

const mockRegister = vi.fn()
const PROVIDER_REGISTRATION_TEST_TIMEOUT_MS = 15_000

const mockGetAll = vi.fn<() => ProviderDefinition[]>().mockReturnValue([])
const mockIndexModels = vi.fn()

vi.mock('../registry', () => ({
  providerRegistry: {
    register: (...args: unknown[]) => mockRegister(...args),
    getAll: () => mockGetAll(),
    indexModels: (...args: unknown[]) => mockIndexModels(...args),
  },
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

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

function makeStubProvider(
  overrides: Partial<ProviderDefinition> & { id: Provider },
): ProviderDefinition {
  return {
    displayName: overrides.id,
    requiresApiKey: false,
    supportsBaseUrl: false,
    supportsSubscription: false,
    supportsDynamicModelFetch: false,
    models: [],
    testModel: 'test',
    supportsAttachment: () => false,
    createAdapter: () => stubTextAdapter(),
    resolveSampling: vi.fn(),
    ...overrides,
  } satisfies ProviderDefinition
}

describe('registerAllProviders', () => {
  beforeEach(() => {
    vi.resetModules()
    mockRegister.mockClear()
    mockGetAll.mockReset().mockReturnValue([])
    mockIndexModels.mockClear()
  })

  it(
    'registers all 6 providers',
    async () => {
      const { registerAllProviders } = await import('../index')
      await registerAllProviders()
      expect(mockRegister).toHaveBeenCalledTimes(6)

      const registeredIds = mockRegister.mock.calls.map((call) => {
        const provider: unknown = call[0]
        if (typeof provider === 'object' && provider !== null && 'id' in provider) {
          return provider.id
        }
        throw new Error('Expected registered provider to have an id property')
      })
      expect(registeredIds).toContain('anthropic')
      expect(registeredIds).toContain('openai')
      expect(registeredIds).toContain('gemini')
      expect(registeredIds).toContain('grok')
      expect(registeredIds).toContain('openrouter')
      expect(registeredIds).toContain('ollama')
    },
    PROVIDER_REGISTRATION_TEST_TIMEOUT_MS,
  )
})

describe('indexStaticSubscriptionModels', () => {
  beforeEach(() => {
    vi.resetModules()
    mockRegister.mockClear()
    mockGetAll.mockReset().mockReturnValue([])
    mockIndexModels.mockClear()
  })

  it(
    'indexes static subscription model IDs from providers that declare them',
    async () => {
      const subscriptionModels = ['gpt-5.4', 'gpt-5.3-codex'] as const
      const subscriptionProvider = makeStubProvider({
        id: 'openai',
        getStaticSubscriptionModels: () => subscriptionModels,
      })

      mockGetAll.mockReturnValue([subscriptionProvider])

      const { registerAllProviders } = await import('../index')
      await registerAllProviders()

      expect(mockIndexModels).toHaveBeenCalledWith(subscriptionModels, subscriptionProvider)
    },
    PROVIDER_REGISTRATION_TEST_TIMEOUT_MS,
  )

  it(
    'skips providers without getStaticSubscriptionModels',
    async () => {
      const noStaticModelsProvider = makeStubProvider({
        id: 'gemini',
        // getStaticSubscriptionModels intentionally absent
      })
      const anotherProvider = makeStubProvider({
        id: 'ollama',
        supportsSubscription: true,
        // has supportsSubscription but no getStaticSubscriptionModels
      })

      mockGetAll.mockReturnValue([noStaticModelsProvider, anotherProvider])

      const { registerAllProviders } = await import('../index')
      await registerAllProviders()

      expect(mockIndexModels).not.toHaveBeenCalled()
    },
    PROVIDER_REGISTRATION_TEST_TIMEOUT_MS,
  )

  it(
    'does not index when getStaticSubscriptionModels returns an empty list',
    async () => {
      const emptyProvider = makeStubProvider({
        id: 'openai',
        getStaticSubscriptionModels: () => [],
      })

      mockGetAll.mockReturnValue([emptyProvider])

      const { registerAllProviders } = await import('../index')
      await registerAllProviders()

      expect(mockIndexModels).not.toHaveBeenCalled()
    },
    PROVIDER_REGISTRATION_TEST_TIMEOUT_MS,
  )

  it(
    'indexes multiple providers independently',
    async () => {
      const openaiModels = ['gpt-5.4'] as const
      const openaiProvider = makeStubProvider({
        id: 'openai',
        getStaticSubscriptionModels: () => openaiModels,
      })
      const anthropicModels = ['claude-sub-1'] as const
      const anthropicProvider = makeStubProvider({
        id: 'anthropic',
        getStaticSubscriptionModels: () => anthropicModels,
      })

      mockGetAll.mockReturnValue([openaiProvider, anthropicProvider])

      const { registerAllProviders } = await import('../index')
      await registerAllProviders()

      expect(mockIndexModels).toHaveBeenCalledWith(openaiModels, openaiProvider)
      expect(mockIndexModels).toHaveBeenCalledWith(anthropicModels, anthropicProvider)
    },
    PROVIDER_REGISTRATION_TEST_TIMEOUT_MS,
  )
})
