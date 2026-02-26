import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSettings: vi.fn(),
    getProviderModels: vi.fn(),
    fetchProviderModels: vi.fn(),
    updateSettings: vi.fn(),
    testApiKey: vi.fn(),
    showConfirm: vi.fn(),
    startOAuth: vi.fn(),
    onOAuthStatus: vi.fn(),
    getAuthAccountInfo: vi.fn(),
  },
}))

vi.mock('@/lib/ipc', () => ({
  api: apiMock,
}))

import { useSettingsStore } from './settings-store'

describe('useSettingsStore integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.onOAuthStatus.mockReturnValue(() => {})
    apiMock.showConfirm.mockResolvedValue(true)
    apiMock.getAuthAccountInfo.mockResolvedValue({
      provider: 'anthropic',
      connected: false,
      label: 'Not connected',
    })
    apiMock.getSettings.mockResolvedValue(DEFAULT_SETTINGS)
    apiMock.fetchProviderModels.mockResolvedValue([])
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      isLoaded: false,
      testingProviders: {},
      testResults: {},
      baseProviderModels: [],
      providerModels: [],
    })
  })

  it('loads persisted settings and models', async () => {
    const loadedSettings = {
      ...DEFAULT_SETTINGS,
      projectPath: '/tmp/repo',
    }
    apiMock.getSettings.mockResolvedValue(loadedSettings)
    apiMock.getProviderModels.mockResolvedValue([
      {
        provider: 'openai',
        displayName: 'OpenAI',
        requiresApiKey: true,
        supportsBaseUrl: false,
        supportsSubscription: true,
        supportsDynamicModelFetch: false,
        models: [{ id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini', provider: 'openai' }],
      },
    ])

    await useSettingsStore.getState().loadSettings()
    await useSettingsStore.getState().loadProviderModels()

    expect(useSettingsStore.getState().isLoaded).toBe(true)
    expect(useSettingsStore.getState().settings.projectPath).toBe('/tmp/repo')
    expect(useSettingsStore.getState().providerModels).toHaveLength(1)
  })

  it('loads static models first and then replaces dynamic-capable providers on success', async () => {
    let resolveDynamic:
      | ((value: { id: string; name: string; provider: 'ollama' }[]) => void)
      | null = null

    apiMock.getProviderModels.mockResolvedValue([
      {
        provider: 'openai',
        displayName: 'OpenAI',
        requiresApiKey: true,
        supportsBaseUrl: false,
        supportsSubscription: true,
        supportsDynamicModelFetch: false,
        models: [{ id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini', provider: 'openai' }],
      },
      {
        provider: 'ollama',
        displayName: 'Ollama',
        requiresApiKey: false,
        supportsBaseUrl: true,
        supportsSubscription: false,
        supportsDynamicModelFetch: true,
        models: [{ id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' }],
      },
    ])
    apiMock.fetchProviderModels.mockImplementationOnce(
      () =>
        new Promise<{ id: string; name: string; provider: 'ollama' }[]>((resolve) => {
          resolveDynamic = resolve
        }),
    )

    const loadPromise = useSettingsStore.getState().loadProviderModels()

    await vi.waitFor(() => {
      expect(
        useSettingsStore.getState().providerModels.find((g) => g.provider === 'ollama')?.models,
      ).toEqual([{ id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' }])
    })

    resolveDynamic?.([
      { id: 'qwen2.5-coder:latest', name: 'Qwen2.5 Coder:latest', provider: 'ollama' },
    ])
    await loadPromise

    expect(
      useSettingsStore.getState().providerModels.find((g) => g.provider === 'ollama')?.models,
    ).toEqual([{ id: 'qwen2.5-coder:latest', name: 'Qwen2.5 Coder:latest', provider: 'ollama' }])
    expect(apiMock.fetchProviderModels).toHaveBeenCalledWith(
      'ollama',
      'http://localhost:11434',
      undefined,
    )
  })

  it('keeps static models when dynamic fetch returns empty list', async () => {
    apiMock.getProviderModels.mockResolvedValue([
      {
        provider: 'ollama',
        displayName: 'Ollama',
        requiresApiKey: false,
        supportsBaseUrl: true,
        supportsSubscription: false,
        supportsDynamicModelFetch: true,
        models: [{ id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' }],
      },
    ])
    apiMock.fetchProviderModels.mockResolvedValueOnce([])

    await useSettingsStore.getState().loadProviderModels()

    expect(useSettingsStore.getState().providerModels[0]?.models).toEqual([
      { id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' },
    ])
  })

  it('keeps static models when dynamic fetch fails', async () => {
    apiMock.getProviderModels.mockResolvedValue([
      {
        provider: 'ollama',
        displayName: 'Ollama',
        requiresApiKey: false,
        supportsBaseUrl: true,
        supportsSubscription: false,
        supportsDynamicModelFetch: true,
        models: [{ id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' }],
      },
    ])
    apiMock.fetchProviderModels.mockRejectedValueOnce(new Error('offline'))

    await useSettingsStore.getState().loadProviderModels()

    expect(useSettingsStore.getState().providerModels[0]?.models).toEqual([
      { id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' },
    ])
  })

  it('dedupes duplicate dynamic models by provider:modelId', async () => {
    apiMock.getProviderModels.mockResolvedValue([
      {
        provider: 'ollama',
        displayName: 'Ollama',
        requiresApiKey: false,
        supportsBaseUrl: true,
        supportsSubscription: false,
        supportsDynamicModelFetch: true,
        models: [{ id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' }],
      },
    ])
    apiMock.fetchProviderModels.mockResolvedValueOnce([
      { id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' },
      { id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' },
    ])

    await useSettingsStore.getState().loadProviderModels()

    expect(useSettingsStore.getState().providerModels[0]?.models).toEqual([
      { id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' },
    ])
  })

  it('updates API key and default model through IPC', async () => {
    await useSettingsStore.getState().updateApiKey('openai', 'sk-live')
    await useSettingsStore.getState().setDefaultModel('gpt-4.1-mini')

    expect(apiMock.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({
          openai: expect.objectContaining({ apiKey: 'sk-live' }),
        }),
      }),
    )
    expect(apiMock.updateSettings).toHaveBeenCalledWith({ defaultModel: 'gpt-4.1-mini' })
    expect(useSettingsStore.getState().settings.defaultModel).toBe('gpt-4.1-mini')
  })

  it('preserves provider authMethod when toggling provider enabled state', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        providers: {
          ...DEFAULT_SETTINGS.providers,
          openai: {
            apiKey: 'sk-openai',
            enabled: true,
            authMethod: 'subscription',
          },
        },
      },
    })

    await useSettingsStore.getState().toggleProvider('openai', false)

    expect(apiMock.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({
          openai: expect.objectContaining({
            enabled: false,
            authMethod: 'subscription',
          }),
        }),
      }),
    )
    expect(useSettingsStore.getState().settings.providers.openai?.authMethod).toBe('subscription')
  })

  it('preserves provider authMethod when updating base URL', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        providers: {
          ...DEFAULT_SETTINGS.providers,
          ollama: {
            apiKey: '',
            enabled: true,
            baseUrl: 'http://localhost:11434',
            authMethod: 'api-key',
          },
        },
      },
    })

    await useSettingsStore.getState().updateBaseUrl('ollama', 'http://localhost:11435')

    expect(apiMock.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({
          ollama: expect.objectContaining({
            baseUrl: 'http://localhost:11435',
            authMethod: 'api-key',
          }),
        }),
      }),
    )
    expect(useSettingsStore.getState().settings.providers.ollama?.authMethod).toBe('api-key')
  })

  it('triggers targeted model refresh after updating base URL', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        providers: {
          ...DEFAULT_SETTINGS.providers,
          ollama: {
            apiKey: '',
            enabled: true,
            baseUrl: 'http://localhost:11434',
          },
        },
      },
      baseProviderModels: [
        {
          provider: 'ollama',
          displayName: 'Ollama',
          requiresApiKey: false,
          supportsBaseUrl: true,
          supportsSubscription: false,
          supportsDynamicModelFetch: true,
          models: [{ id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' }],
        },
      ],
      providerModels: [
        {
          provider: 'ollama',
          displayName: 'Ollama',
          requiresApiKey: false,
          supportsBaseUrl: true,
          supportsSubscription: false,
          supportsDynamicModelFetch: true,
          models: [{ id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' }],
        },
      ],
    })

    await useSettingsStore.getState().updateBaseUrl('ollama', 'http://localhost:11435')

    await vi.waitFor(() => {
      expect(apiMock.fetchProviderModels).toHaveBeenCalledWith(
        'ollama',
        'http://localhost:11435',
        undefined,
      )
    })
  })

  it('triggers targeted model refresh after API key updates', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        providers: {
          ...DEFAULT_SETTINGS.providers,
          openai: {
            apiKey: '',
            enabled: true,
          },
        },
      },
      baseProviderModels: [
        {
          provider: 'openai',
          displayName: 'OpenAI',
          requiresApiKey: true,
          supportsBaseUrl: false,
          supportsSubscription: true,
          supportsDynamicModelFetch: true,
          models: [{ id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini', provider: 'openai' }],
        },
      ],
      providerModels: [
        {
          provider: 'openai',
          displayName: 'OpenAI',
          requiresApiKey: true,
          supportsBaseUrl: false,
          supportsSubscription: true,
          supportsDynamicModelFetch: true,
          models: [{ id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini', provider: 'openai' }],
        },
      ],
    })

    await useSettingsStore.getState().updateApiKey('openai', 'sk-live')

    await vi.waitFor(() => {
      expect(apiMock.fetchProviderModels).toHaveBeenCalledWith('openai', undefined, 'sk-live')
    })
  })

  it('triggers targeted model refresh after provider toggle', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        providers: {
          ...DEFAULT_SETTINGS.providers,
          ollama: {
            apiKey: '',
            enabled: false,
            baseUrl: 'http://localhost:11434',
          },
        },
      },
      baseProviderModels: [
        {
          provider: 'ollama',
          displayName: 'Ollama',
          requiresApiKey: false,
          supportsBaseUrl: true,
          supportsSubscription: false,
          supportsDynamicModelFetch: true,
          models: [{ id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' }],
        },
      ],
      providerModels: [
        {
          provider: 'ollama',
          displayName: 'Ollama',
          requiresApiKey: false,
          supportsBaseUrl: true,
          supportsSubscription: false,
          supportsDynamicModelFetch: true,
          models: [{ id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' }],
        },
      ],
    })

    await useSettingsStore.getState().toggleProvider('ollama', true)

    await vi.waitFor(() => {
      expect(apiMock.fetchProviderModels).toHaveBeenCalledWith(
        'ollama',
        'http://localhost:11434',
        undefined,
      )
    })
  })

  it('does not cancel one provider refresh when another provider refresh starts', async () => {
    let resolveOpenAi:
      | ((value: { id: string; name: string; provider: 'openai' }[]) => void)
      | null = null

    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        providers: {
          ...DEFAULT_SETTINGS.providers,
          openai: {
            apiKey: 'sk-openai',
            enabled: true,
          },
          ollama: {
            apiKey: '',
            enabled: true,
            baseUrl: 'http://localhost:11434',
          },
        },
      },
      baseProviderModels: [
        {
          provider: 'openai',
          displayName: 'OpenAI',
          requiresApiKey: true,
          supportsBaseUrl: false,
          supportsSubscription: true,
          supportsDynamicModelFetch: true,
          models: [{ id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini', provider: 'openai' }],
        },
        {
          provider: 'ollama',
          displayName: 'Ollama',
          requiresApiKey: false,
          supportsBaseUrl: true,
          supportsSubscription: false,
          supportsDynamicModelFetch: true,
          models: [{ id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' }],
        },
      ],
      providerModels: [
        {
          provider: 'openai',
          displayName: 'OpenAI',
          requiresApiKey: true,
          supportsBaseUrl: false,
          supportsSubscription: true,
          supportsDynamicModelFetch: true,
          models: [{ id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini', provider: 'openai' }],
        },
        {
          provider: 'ollama',
          displayName: 'Ollama',
          requiresApiKey: false,
          supportsBaseUrl: true,
          supportsSubscription: false,
          supportsDynamicModelFetch: true,
          models: [{ id: 'llama3.2:latest', name: 'Llama3.2:latest', provider: 'ollama' }],
        },
      ],
    })

    apiMock.fetchProviderModels.mockImplementation((provider: string) => {
      if (provider === 'openai') {
        return new Promise<{ id: string; name: string; provider: 'openai' }[]>((resolve) => {
          resolveOpenAi = resolve
        })
      }
      return Promise.resolve([
        {
          id: 'qwen2.5-coder:latest',
          name: 'Qwen2.5 Coder:latest',
          provider: 'ollama',
        },
      ])
    })

    const openAiRefresh = useSettingsStore.getState().refreshProviderModels('openai')
    await vi.waitFor(() => {
      expect(apiMock.fetchProviderModels).toHaveBeenCalledWith('openai', undefined, 'sk-openai')
    })

    await useSettingsStore.getState().refreshProviderModels('ollama')
    expect(
      useSettingsStore.getState().providerModels.find((g) => g.provider === 'ollama')?.models,
    ).toEqual([
      {
        id: 'qwen2.5-coder:latest',
        name: 'Qwen2.5 Coder:latest',
        provider: 'ollama',
      },
    ])

    resolveOpenAi?.([
      {
        id: 'gpt-5-mini',
        name: 'GPT 5 Mini',
        provider: 'openai',
      },
    ])
    await openAiRefresh

    expect(
      useSettingsStore.getState().providerModels.find((g) => g.provider === 'openai')?.models,
    ).toEqual([
      {
        id: 'gpt-5-mini',
        name: 'GPT 5 Mini',
        provider: 'openai',
      },
    ])
    expect(
      useSettingsStore.getState().providerModels.find((g) => g.provider === 'ollama')?.models,
    ).toEqual([
      {
        id: 'qwen2.5-coder:latest',
        name: 'Qwen2.5 Coder:latest',
        provider: 'ollama',
      },
    ])
  })

  it('auto-enables provider when selecting a model from a disabled configured provider', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        providers: {
          ...DEFAULT_SETTINGS.providers,
          gemini: {
            apiKey: 'gemini-key',
            enabled: false,
          },
        },
      },
      providerModels: [
        {
          provider: 'gemini',
          displayName: 'Gemini',
          requiresApiKey: true,
          supportsBaseUrl: false,
          supportsSubscription: false,
          supportsDynamicModelFetch: false,
          models: [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini' }],
        },
      ],
    })

    await useSettingsStore.getState().setDefaultModel('gemini-2.5-flash')

    expect(apiMock.updateSettings).toHaveBeenCalledWith({
      defaultModel: 'gemini-2.5-flash',
      providers: expect.objectContaining({
        gemini: expect.objectContaining({
          apiKey: 'gemini-key',
          enabled: true,
        }),
      }),
    })
    expect(useSettingsStore.getState().settings.providers.gemini?.enabled).toBe(true)
  })

  it('persists execution mode and quality preset updates', async () => {
    await useSettingsStore.getState().setExecutionMode('full-access')
    await useSettingsStore.getState().setQualityPreset('high')

    expect(apiMock.updateSettings).toHaveBeenCalledWith({ executionMode: 'full-access' })
    expect(apiMock.updateSettings).toHaveBeenCalledWith({ qualityPreset: 'high' })
    expect(useSettingsStore.getState().settings.executionMode).toBe('full-access')
    expect(useSettingsStore.getState().settings.qualityPreset).toBe('high')
  })

  it('clears API key when given empty string', async () => {
    await useSettingsStore.getState().updateApiKey('openai', '  ')
    expect(apiMock.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({
          openai: expect.objectContaining({ apiKey: '', enabled: false }),
        }),
      }),
    )
  })

  it('tracks testApiKey success and failure state', async () => {
    apiMock.testApiKey.mockResolvedValueOnce({ success: true })
    const success = await useSettingsStore.getState().testApiKey('openai', 'sk-test')
    expect(success).toBe(true)
    expect(useSettingsStore.getState().testResults.openai).toEqual({ success: true })

    apiMock.testApiKey.mockRejectedValueOnce(new Error('network'))
    const failure = await useSettingsStore.getState().testApiKey('openai', 'sk-test')
    expect(failure).toBe(false)
    expect(useSettingsStore.getState().testResults.openai).toEqual({
      success: false,
      error: 'Unexpected error — check the console',
    })
    expect(useSettingsStore.getState().testingProviders.openai).toBe(false)
  })

  it('clears provider test results', () => {
    useSettingsStore.setState({
      testResults: { openai: { success: false, error: 'bad key' } },
    })

    useSettingsStore.getState().clearTestResult('openai')
    expect(useSettingsStore.getState().testResults.openai).toBeNull()
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
      await useSettingsStore.getState().setProjectPath(path)
    }
    await useSettingsStore.getState().setProjectPath('/tmp/repo-9')

    const recentProjects = useSettingsStore.getState().settings.recentProjects
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
    await useSettingsStore.getState().toggleFavoriteModel('gpt-4.1-mini')
    await useSettingsStore.getState().toggleFavoriteModel('claude-sonnet-4-5')
    await useSettingsStore.getState().toggleFavoriteModel('gpt-4.1-mini')

    expect(apiMock.updateSettings).toHaveBeenNthCalledWith(1, {
      favoriteModels: ['gpt-4.1-mini'],
    })
    expect(apiMock.updateSettings).toHaveBeenNthCalledWith(2, {
      favoriteModels: ['claude-sonnet-4-5', 'gpt-4.1-mini'],
    })
    expect(apiMock.updateSettings).toHaveBeenNthCalledWith(3, {
      favoriteModels: ['claude-sonnet-4-5'],
    })

    expect(useSettingsStore.getState().settings.favoriteModels).toEqual(['claude-sonnet-4-5'])
  })

  it('requires explicit risk confirmation before Anthropic subscription sign-in', async () => {
    apiMock.showConfirm.mockResolvedValue(false)

    await useSettingsStore.getState().startOAuth('anthropic')

    expect(apiMock.showConfirm).toHaveBeenCalledTimes(1)
    expect(apiMock.startOAuth).not.toHaveBeenCalled()
  })

  it('starts Anthropic subscription sign-in after risk confirmation', async () => {
    apiMock.showConfirm.mockResolvedValue(true)
    apiMock.startOAuth.mockResolvedValue(undefined)

    await useSettingsStore.getState().startOAuth('anthropic')

    expect(apiMock.showConfirm).toHaveBeenCalledTimes(1)
    expect(apiMock.startOAuth).toHaveBeenCalledWith('anthropic')
  })
})
