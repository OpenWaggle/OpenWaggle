import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSettings: vi.fn(),
    getProviderModels: vi.fn(),
    updateSettings: vi.fn(),
    testApiKey: vi.fn(),
  },
}))

vi.mock('@/lib/ipc', () => ({
  api: apiMock,
}))

import { useSettingsStore } from './settings-store'

describe('useSettingsStore integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      isLoaded: false,
      testingProviders: {},
      testResults: {},
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
        models: [{ id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini', provider: 'openai' }],
      },
    ])

    await useSettingsStore.getState().loadSettings()
    await useSettingsStore.getState().loadProviderModels()

    expect(useSettingsStore.getState().isLoaded).toBe(true)
    expect(useSettingsStore.getState().settings.projectPath).toBe('/tmp/repo')
    expect(useSettingsStore.getState().providerModels).toHaveLength(1)
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
})
