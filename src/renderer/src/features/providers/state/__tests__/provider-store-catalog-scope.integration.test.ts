import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '../provider-store'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSettings: vi.fn(),
    getProviderModels: vi.fn(),
    updateSettings: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

const SETTINGS = { ...DEFAULT_SETTINGS, projectPath: '/repo/demo' }

function providerGroup(provider: string, modelId: string): ProviderInfo {
  return {
    provider,
    displayName: provider,
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
        id: SupportedModelId(`${provider}/${modelId}`),
        modelId,
        name: modelId,
        provider,
        available: true,
        availableThinkingLevels: ['off'],
      },
    ],
  }
}

/*
 * Startup loads every provider with only its runnable models, which is all the composer offers;
 * Settings asks for the full catalog once (renderer-load B14).
 */
describe('provider catalog scope', () => {
  beforeEach(() => {
    apiMock.getSettings.mockReset().mockResolvedValue(SETTINGS)
    apiMock.getProviderModels.mockReset()
    apiMock.updateSettings.mockReset().mockResolvedValue(undefined)
    useProviderStore.setState({
      baseProviderModels: [],
      providerModels: [],
      catalogScope: 'available',
      catalogHydrated: false,
      isLoading: false,
      loadError: null,
    })
  })

  it('loads only runnable models at startup and the full catalog once Settings asks', async () => {
    apiMock.getProviderModels.mockResolvedValue([providerGroup('openai', 'gpt-5')])

    await useProviderStore.getState().loadProviderModels(SETTINGS)
    await useProviderStore.getState().ensureFullProviderCatalog()
    await useProviderStore.getState().ensureFullProviderCatalog()
    await useProviderStore.getState().loadProviderModels(SETTINGS)

    expect(apiMock.getProviderModels.mock.calls).toEqual([
      ['/repo/demo', 'available'],
      ['/repo/demo', 'all'],
      // A reload after Settings opened keeps the full catalog.
      ['/repo/demo', 'all'],
    ])
  })

  it('keeps the full catalog when a slower startup load answers after it', async () => {
    let answerStartupLoad: (models: ProviderInfo[]) => void = () => {}
    apiMock.getProviderModels
      .mockImplementationOnce(
        () =>
          new Promise<ProviderInfo[]>((resolve) => {
            answerStartupLoad = resolve
          }),
      )
      .mockResolvedValueOnce([providerGroup('openai', 'gpt-5'), providerGroup('ollama', 'qwen')])

    const startupLoad = useProviderStore.getState().loadProviderModels(SETTINGS)
    await useProviderStore.getState().ensureFullProviderCatalog()
    answerStartupLoad([providerGroup('openai', 'gpt-5')])
    await startupLoad

    expect(useProviderStore.getState().providerModels.map((group) => group.provider)).toEqual([
      'openai',
      'ollama',
    ])
    expect(useProviderStore.getState().isLoading).toBe(false)
  })
})
