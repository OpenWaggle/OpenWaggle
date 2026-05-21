import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../auth-store'
import { useProviderStore } from '../provider-store'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSettings: vi.fn(),
    getProviderModels: vi.fn(),
    updateSettings: vi.fn(),
    setProviderApiKey: vi.fn(),
    testApiKey: vi.fn(),
    showConfirm: vi.fn(),
    startOAuth: vi.fn(),
    onOAuthStatus: vi.fn(),
    getAuthAccountInfo: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

function resetProviderStore() {
  useProviderStore.setState({
    baseProviderModels: [],
    providerModels: [],
    isLoading: false,
    testingProviders: {},
    testResults: {},
    loadError: null,
  })
}

function openAiProviderModels(): ProviderInfo[] {
  return [
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
}

function ollamaProviderModels(): ProviderInfo[] {
  return [
    {
      provider: 'ollama',
      displayName: 'Ollama',
      auth: {
        configured: true,
        source: 'environment-or-custom',
        apiKeyConfigured: true,
        apiKeySource: 'environment-or-custom',
        oauthConnected: false,
        supportsApiKey: true,
        supportsOAuth: false,
      },
      models: [
        {
          id: SupportedModelId('ollama/llama3.2:latest'),
          modelId: 'llama3.2:latest',
          name: 'Llama3.2:latest',
          provider: 'ollama',
          available: true,
          availableThinkingLevels: ['off'],
        },
      ],
    },
  ]
}

describe('provider-store integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getSettings.mockResolvedValue(DEFAULT_SETTINGS)
    apiMock.getProviderModels.mockResolvedValue([])
    apiMock.setProviderApiKey.mockResolvedValue(undefined)
    resetProviderStore()
  })

  it('loads provider models', async () => {
    apiMock.getProviderModels.mockResolvedValue(openAiProviderModels())

    await useProviderStore.getState().loadProviderModels()

    expect(useProviderStore.getState().providerModels).toHaveLength(1)
  })

  it('does not clear model preferences when Pi returns an empty provider catalog', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      selectedModel: SupportedModelId('openai-codex/gpt-5.5'),
      enabledModels: [SupportedModelId('openai-codex/gpt-5.5')],
    }
    apiMock.getSettings.mockResolvedValue(settings)
    apiMock.getProviderModels.mockResolvedValue([])

    const updatedSettings = await useProviderStore.getState().loadProviderModels(settings)

    expect(updatedSettings).toBeNull()
    expect(apiMock.updateSettings).not.toHaveBeenCalled()
    expect(useProviderStore.getState().isLoading).toBe(false)
  })

  it('keeps Pi catalog models when loading provider groups', async () => {
    apiMock.getProviderModels.mockResolvedValue(ollamaProviderModels())

    await useProviderStore.getState().loadProviderModels()

    expect(useProviderStore.getState().providerModels[0]?.models).toEqual([
      {
        id: 'ollama/llama3.2:latest',
        modelId: 'llama3.2:latest',
        name: 'Llama3.2:latest',
        provider: 'ollama',
        available: true,
        availableThinkingLevels: ['off'],
      },
    ])
  })

  it('updates API key through Pi auth storage and reloads the Pi catalog', async () => {
    await useProviderStore.getState().updateApiKey('openai', 'sk-live')

    expect(apiMock.setProviderApiKey).toHaveBeenCalledWith('openai', 'sk-live')
    expect(apiMock.getProviderModels).toHaveBeenCalledOnce()
    expect(apiMock.updateSettings).not.toHaveBeenCalled()
  })

  it('clears API key when given empty string', async () => {
    await useProviderStore.getState().updateApiKey('openai', '  ')

    expect(apiMock.setProviderApiKey).toHaveBeenCalledWith('openai', '')
    expect(apiMock.getProviderModels).toHaveBeenCalledOnce()
  })

  it('tracks testApiKey success and failure state', async () => {
    apiMock.testApiKey.mockResolvedValueOnce({ success: true })
    const success = await useProviderStore.getState().testApiKey('openai', 'sk-test')

    expect(success).toBe(true)
    expect(useProviderStore.getState().testResults.openai).toEqual({ success: true })
    expect(apiMock.testApiKey).toHaveBeenNthCalledWith(1, 'openai', 'sk-test', null)

    apiMock.testApiKey.mockRejectedValueOnce(new Error('network'))
    const failure = await useProviderStore.getState().testApiKey('openai', 'sk-test')

    expect(failure).toBe(false)
    expect(useProviderStore.getState().testResults.openai).toEqual({
      success: false,
      error: 'Unexpected error — check the console',
    })
    expect(useProviderStore.getState().testingProviders.openai).toBe(false)
    expect(apiMock.testApiKey).toHaveBeenNthCalledWith(2, 'openai', 'sk-test', null)
  })

  it('clears provider test results', () => {
    useProviderStore.setState({
      testResults: { openai: { success: false, error: 'bad key' } },
    })

    useProviderStore.getState().clearTestResult('openai')
    expect(useProviderStore.getState().testResults.openai).toBeNull()
  })
})

describe('auth-store integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.onOAuthStatus.mockReturnValue(() => {})
    apiMock.showConfirm.mockResolvedValue(true)
    apiMock.getSettings.mockResolvedValue(DEFAULT_SETTINGS)
    apiMock.getProviderModels.mockResolvedValue([])
    apiMock.getAuthAccountInfo.mockResolvedValue({
      provider: 'anthropic',
      connected: false,
      label: 'Not connected',
    })
    useAuthStore.setState({
      oauthStatuses: {},
      authAccounts: {},
    })
    resetProviderStore()
  })

  it('starts Anthropic OAuth without OpenWaggle risk confirmation', async () => {
    apiMock.showConfirm.mockResolvedValue(false)
    apiMock.startOAuth.mockResolvedValue(undefined)

    await useAuthStore.getState().startOAuth('anthropic')

    expect(apiMock.showConfirm).not.toHaveBeenCalled()
    expect(apiMock.startOAuth).toHaveBeenCalledWith('anthropic')
  })

  it('starts any Pi OAuth provider directly', async () => {
    apiMock.showConfirm.mockResolvedValue(true)
    apiMock.startOAuth.mockResolvedValue(undefined)

    await useAuthStore.getState().startOAuth('google-gemini-cli')

    expect(apiMock.showConfirm).not.toHaveBeenCalled()
    expect(apiMock.startOAuth).toHaveBeenCalledWith('google-gemini-cli')
  })
})
