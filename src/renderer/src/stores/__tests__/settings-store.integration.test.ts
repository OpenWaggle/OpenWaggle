import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSettings: vi.fn(),
    getProviderModels: vi.fn(),
    updateSettings: vi.fn(),
    setProviderApiKey: vi.fn(),
    setEnabledModels: vi.fn(),
    testApiKey: vi.fn(),
    showConfirm: vi.fn(),
    getProjectPreferences: vi.fn(),
    setProjectPreferences: vi.fn(),
    startOAuth: vi.fn(),
    cancelOAuth: vi.fn(),
    onOAuthStatus: vi.fn(),
    getAuthAccountInfo: vi.fn(),
    disconnectAuth: vi.fn(),
    submitAuthCode: vi.fn(),
  },
}))

vi.mock('@/lib/ipc', () => ({
  api: apiMock,
}))

import { useAuthStore } from '../auth-store'
import { usePreferencesStore } from '../preferences-store'
import { useProviderStore } from '../provider-store'

describe('preferences-store integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getSettings.mockResolvedValue(DEFAULT_SETTINGS)
    apiMock.getProviderModels.mockResolvedValue([])
    apiMock.setProviderApiKey.mockResolvedValue(undefined)
    apiMock.setEnabledModels.mockResolvedValue(undefined)
    usePreferencesStore.setState({
      settings: DEFAULT_SETTINGS,
      isLoaded: false,
      loadError: null,
    })
    useProviderStore.setState({
      baseProviderModels: [],
      providerModels: [],
      testingProviders: {},
      testResults: {},
    })
  })

  it('loads persisted settings', async () => {
    const loadedSettings = {
      ...DEFAULT_SETTINGS,
      projectPath: '/tmp/repo',
    }
    apiMock.getSettings.mockResolvedValue(loadedSettings)

    await usePreferencesStore.getState().loadSettings()

    expect(usePreferencesStore.getState().isLoaded).toBe(true)
    expect(usePreferencesStore.getState().settings.projectPath).toBe('/tmp/repo')
  })

  it('persists thinking level updates', async () => {
    await usePreferencesStore.getState().setThinkingLevel('high')

    expect(apiMock.updateSettings).toHaveBeenCalledWith({ thinkingLevel: 'high' })
    expect(usePreferencesStore.getState().settings.thinkingLevel).toBe('high')
  })

  it('tracks recent projects in newest-first order with dedupe and max size', async () => {
    const entries = [
      '/tmp/repo-1',
      '/tmp/repo-2',
      '/tmp/repo-3',
      '/tmp/repo-4',
      '/tmp/repo-5',
      '/tmp/repo-6',
      '/tmp/repo-7',
      '/tmp/repo-8',
      '/tmp/repo-9',
      '/tmp/repo-10',
      '/tmp/repo-11',
    ]

    for (const path of entries) {
      await usePreferencesStore.getState().setProjectPath(path)
    }
    await usePreferencesStore.getState().setProjectPath('/tmp/repo-9')

    const recentProjects = usePreferencesStore.getState().settings.recentProjects
    expect(recentProjects).toEqual([
      '/tmp/repo-9',
      '/tmp/repo-11',
      '/tmp/repo-10',
      '/tmp/repo-8',
      '/tmp/repo-7',
      '/tmp/repo-6',
      '/tmp/repo-5',
      '/tmp/repo-4',
      '/tmp/repo-3',
      '/tmp/repo-2',
    ])
    expect(recentProjects).toHaveLength(10)
  })

  it('toggles favorite models and persists deduped order', async () => {
    await usePreferencesStore
      .getState()
      .toggleFavoriteModel(SupportedModelId('openai/gpt-4.1-mini'))
    await usePreferencesStore
      .getState()
      .toggleFavoriteModel(SupportedModelId('anthropic/claude-sonnet-4-5'))
    await usePreferencesStore
      .getState()
      .toggleFavoriteModel(SupportedModelId('openai/gpt-4.1-mini'))

    expect(apiMock.updateSettings).toHaveBeenNthCalledWith(1, {
      favoriteModels: ['openai/gpt-4.1-mini'],
    })
    expect(apiMock.updateSettings).toHaveBeenNthCalledWith(2, {
      favoriteModels: ['anthropic/claude-sonnet-4-5', 'openai/gpt-4.1-mini'],
    })
    expect(apiMock.updateSettings).toHaveBeenNthCalledWith(3, {
      favoriteModels: ['anthropic/claude-sonnet-4-5'],
    })

    expect(usePreferencesStore.getState().settings.favoriteModels).toEqual([
      'anthropic/claude-sonnet-4-5',
    ])
  })
})

describe('provider-store integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getSettings.mockResolvedValue(DEFAULT_SETTINGS)
    apiMock.getProviderModels.mockResolvedValue([])
    apiMock.setProviderApiKey.mockResolvedValue(undefined)
    apiMock.setEnabledModels.mockResolvedValue(undefined)
    usePreferencesStore.setState({
      settings: DEFAULT_SETTINGS,
      isLoaded: true,
      loadError: null,
    })
    useProviderStore.setState({
      baseProviderModels: [],
      providerModels: [],
      testingProviders: {},
      testResults: {},
    })
  })

  it('loads provider models', async () => {
    const providerModels: ProviderInfo[] = [
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
    apiMock.getProviderModels.mockResolvedValue(providerModels)

    await useProviderStore.getState().loadProviderModels()

    expect(useProviderStore.getState().providerModels).toHaveLength(1)
  })

  it('keeps Pi catalog models when loading provider groups', async () => {
    const providerModels: ProviderInfo[] = [
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
    apiMock.getProviderModels.mockResolvedValue(providerModels)

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

  it('sets default model through preferences store', async () => {
    await usePreferencesStore.getState().setSelectedModel(SupportedModelId('openai/gpt-4.1-mini'))

    expect(apiMock.updateSettings).toHaveBeenCalledWith({ selectedModel: 'openai/gpt-4.1-mini' })
    expect(usePreferencesStore.getState().settings.selectedModel).toBe('openai/gpt-4.1-mini')
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
    apiMock.getAuthAccountInfo.mockResolvedValue({
      provider: 'anthropic',
      connected: false,
      label: 'Not connected',
    })
    usePreferencesStore.setState({
      settings: DEFAULT_SETTINGS,
      isLoaded: true,
      loadError: null,
    })
    useAuthStore.setState({
      oauthStatuses: {},
      authAccounts: {},
    })
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
