import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSettings: vi.fn(),
    getProviderModels: vi.fn(),
    updateSettings: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

import { useProviderStore } from '../provider-store'

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
      supportsOAuth: false,
    },
    models: [
      {
        id: SupportedModelId('anthropic/claude-sonnet-4-5'),
        modelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        provider: 'anthropic',
        available: true,
        availableThinkingLevels: ['off'],
      },
    ],
  },
]

describe('a provider catalog that fails to load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderStore.setState(useProviderStore.getInitialState())
  })

  it('records the error and settles loading, so the UI does not wait forever', async () => {
    apiMock.getProviderModels.mockRejectedValue(new Error('Pi catalog unavailable'))

    const updatedSettings = await useProviderStore.getState().loadProviderModels(DEFAULT_SETTINGS)

    expect(updatedSettings).toBeNull()
    expect(useProviderStore.getState()).toMatchObject({
      loadError: 'Pi catalog unavailable',
      catalogHydrated: true,
      isLoading: false,
      providerModels: [],
    })
    expect(apiMock.updateSettings).not.toHaveBeenCalled()
  })

  it('clears the error when a later load succeeds', async () => {
    apiMock.getProviderModels.mockRejectedValueOnce(new Error('Pi catalog unavailable'))
    await useProviderStore.getState().loadProviderModels(DEFAULT_SETTINGS)
    apiMock.getProviderModels.mockResolvedValueOnce(PROVIDER_MODELS)

    await useProviderStore.getState().loadProviderModels(DEFAULT_SETTINGS)

    expect(useProviderStore.getState().loadError).toBeNull()
    expect(useProviderStore.getState().providerModels.map((group) => group.provider)).toEqual([
      'anthropic',
    ])
  })

  it('clears the previous error as soon as a retry starts', async () => {
    useProviderStore.setState({ loadError: 'Pi catalog unavailable', catalogHydrated: true })
    let resolveCatalog = (_models: ProviderInfo[]) => {}
    apiMock.getProviderModels.mockReturnValue(
      new Promise<ProviderInfo[]>((resolve) => {
        resolveCatalog = resolve
      }),
    )

    const load = useProviderStore.getState().loadProviderModels(DEFAULT_SETTINGS)

    expect(useProviderStore.getState()).toMatchObject({ loadError: null, isLoading: true })
    resolveCatalog(PROVIDER_MODELS)
    await load
    expect(useProviderStore.getState().isLoading).toBe(false)
  })
})
