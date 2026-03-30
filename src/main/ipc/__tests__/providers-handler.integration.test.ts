import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderService } from '../../ports/provider-service'

const { typedHandleMock, getAllMock, getMock, indexModelsMock, fetchModelsMock } = vi.hoisted(
  () => ({
    typedHandleMock: vi.fn(),
    getAllMock: vi.fn(),
    getMock: vi.fn(),
    indexModelsMock: vi.fn(),
    fetchModelsMock: vi.fn(),
  }),
)

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

const TestProviderServiceLayer = Layer.succeed(ProviderService, {
  get: (providerId) => Effect.sync(() => getMock(providerId)),
  getAll: () => Effect.sync(() => getAllMock()),
  getProviderForModel: () => Effect.succeed({} as never),
  isKnownModel: () => Effect.succeed(true),
  createChatAdapter: () => Effect.succeed({} as never),
  indexModels: (modelIds, providerId) => Effect.sync(() => indexModelsMock(modelIds, providerId)),
  fetchModels: (providerId, baseUrl, apiKey, authMethod) =>
    Effect.tryPromise({
      try: async () => {
        const provider = getMock(providerId)
        if (!provider?.supportsDynamicModelFetch || !provider.fetchModels) return []
        return provider.fetchModels(baseUrl, apiKey, authMethod)
      },
      catch: () => [] as readonly string[],
    }).pipe(Effect.catchAll((models) => Effect.succeed(models))),
})

import { registerProvidersHandlers } from '../providers-handler'

function registeredHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) =>
    Effect.runPromise(Effect.provide(handler(...args), TestProviderServiceLayer))
}

describe('registerProvidersHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    getAllMock.mockReset()
    getMock.mockReset()
    indexModelsMock.mockReset()
    fetchModelsMock.mockReset()
  })

  it('registers providers:get-models and returns mapped display info', async () => {
    getAllMock.mockReturnValue([
      {
        id: 'openai',
        displayName: 'OpenAI',
        requiresApiKey: true,
        apiKeyManagementUrl: 'https://platform.openai.com/api-keys',
        supportsBaseUrl: false,
        supportsDynamicModelFetch: false,
        models: ['gpt-4.1-mini'],
      },
    ])

    registerProvidersHandlers()
    const handler = registeredHandler('providers:get-models')

    expect(handler).toBeDefined()
    const result = await handler?.()
    expect(result).toEqual([
      {
        provider: 'openai',
        displayName: 'OpenAI',
        requiresApiKey: true,
        apiKeyManagementUrl: 'https://platform.openai.com/api-keys',
        supportsBaseUrl: false,
        supportsDynamicModelFetch: false,
        models: [{ id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini', provider: 'openai' }],
      },
    ])
  })

  it('registers providers:fetch-models and returns empty array when provider has no fetchModels', async () => {
    getMock.mockReturnValue({
      id: 'anthropic',
      supportsDynamicModelFetch: false,
      models: ['claude-sonnet-4-5'],
    })

    registerProvidersHandlers()
    const handler = registeredHandler('providers:fetch-models')

    expect(handler).toBeDefined()
    const result = await handler?.({}, 'anthropic')
    expect(result).toEqual([])
  })

  it('maps fetched models to display entries', async () => {
    getMock.mockReturnValue({
      id: 'ollama',
      supportsDynamicModelFetch: true,
      models: ['llama3.1'],
      fetchModels: vi.fn(async () => ['llama3.1', 'qwen2.5-coder']),
    })

    registerProvidersHandlers()
    const handler = registeredHandler('providers:fetch-models')

    const result = await handler?.({}, 'ollama', 'http://localhost:11434', 'unused')
    expect(result).toEqual([
      { id: 'llama3.1', name: 'Llama3.1', provider: 'ollama' },
      { id: 'qwen2.5-coder', name: 'Qwen2.5 Coder', provider: 'ollama' },
    ])
  })
})
