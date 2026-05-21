import { SupportedModelId } from '@shared/types/brand'
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
    getProjectPreferences: vi.fn(),
    setProjectPreferences: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

import { usePreferencesStore } from '../preferences-store'

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

  it('tracks recent projects in first-added order with dedupe and max size', async () => {
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

  it('sets default model through preferences store', async () => {
    await usePreferencesStore.getState().setSelectedModel(SupportedModelId('openai/gpt-4.1-mini'))

    expect(apiMock.updateSettings).toHaveBeenCalledWith({ selectedModel: 'openai/gpt-4.1-mini' })
    expect(usePreferencesStore.getState().settings.selectedModel).toBe('openai/gpt-4.1-mini')
  })
})
