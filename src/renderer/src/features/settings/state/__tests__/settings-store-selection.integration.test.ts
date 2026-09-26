import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { DEFAULT_SHORTCUT_BINDINGS } from '@shared/types/shortcuts'
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
    removeProjectModel: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

import { usePreferencesStore } from '../preferences-store'
import { awaitPendingProjectPreferenceWrites } from '../project-preference-writes'

describe('preferences-store selection integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getSettings.mockResolvedValue(DEFAULT_SETTINGS)
    apiMock.getProviderModels.mockResolvedValue([])
    apiMock.setProviderApiKey.mockResolvedValue(undefined)
    apiMock.setEnabledModels.mockResolvedValue(undefined)
    apiMock.updateSettings.mockResolvedValue({ ok: true })
    apiMock.setProjectPreferences.mockResolvedValue('/repo/b')
    apiMock.removeProjectModel.mockResolvedValue('/repo/b')
    usePreferencesStore.setState({
      settings: DEFAULT_SETTINGS,
      persistedAppearancePreferences: DEFAULT_SETTINGS.appearancePreferences,
      isLoaded: false,
      loadError: null,
    })
  })

  it('does not expose a newly opened project when the Host rejects persistence', async () => {
    apiMock.updateSettings.mockResolvedValueOnce({ ok: false, error: 'Host rejected project' })

    await expect(usePreferencesStore.getState().pushRecentProject('/repo/new')).rejects.toThrow(
      'Host rejected project',
    )
    expect(usePreferencesStore.getState().settings.recentProjects).not.toContain('/repo/new')
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

  it('mirrors nothing for model writes and removes the stored entry through the backend', async () => {
    usePreferencesStore.setState((state) => ({
      settings: {
        ...state.settings,
        // The caller-spelled path is an alias; the backend canonicalizes it on write and removal.
        projectPath: '/repo/b-alias',
        selectedModelsByProject: { '/repo/b': 'openai/gpt-4.1' },
      },
    }))

    await usePreferencesStore.getState().setSelectedModel(SupportedModelId('openai/gpt-4.1-mini'))
    await awaitPendingProjectPreferenceWrites('/repo/b-alias')

    expect(apiMock.setProjectPreferences).toHaveBeenCalledWith('/repo/b-alias', {
      model: 'openai/gpt-4.1-mini',
    })
    // The renderer never submits the model map wholesale; the backend owns the entries.
    expect(apiMock.updateSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ selectedModelsByProject: expect.anything() }),
    )

    await awaitPendingProjectPreferenceWrites('/repo/b-alias')
    await usePreferencesStore.getState().removeProjectReferences('/repo/b-alias')

    // The canonical reference survives the alias removal, so the backend keeps the shared entry.
    expect(apiMock.removeProjectModel).toHaveBeenCalledWith('/repo/b-alias', ['/repo/b'])
  })

  it('keeps shortcut state unchanged when main rejects a duplicate binding', async () => {
    const shortcutBindings = {
      ...DEFAULT_SHORTCUT_BINDINGS,
      'diff.toggle': null,
      'sidebar.toggle': { key: 'D', mod: true },
      'terminal.toggle': { key: 'T', mod: true, shift: true },
    }
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, shortcutBindings },
    })
    apiMock.updateSettings.mockResolvedValue({
      ok: false,
      error: 'Shortcut Mod+D is already assigned to sidebar.toggle.',
    })

    await expect(
      usePreferencesStore
        .getState()
        .setShortcutBinding('diff.toggle', DEFAULT_SHORTCUT_BINDINGS['diff.toggle']),
    ).rejects.toThrow('already assigned')

    expect(usePreferencesStore.getState().settings.shortcutBindings).toEqual(shortcutBindings)
    expect(apiMock.getSettings).not.toHaveBeenCalled()
  })

  it('uses the persisted shortcut snapshot after main sanitizes an accepted binding', async () => {
    const persistedSettings = {
      ...DEFAULT_SETTINGS,
      shortcutBindings: {
        ...DEFAULT_SHORTCUT_BINDINGS,
        'terminal.toggle': { key: 'j', mod: true },
      },
    }
    apiMock.updateSettings.mockResolvedValue({ ok: true })
    apiMock.getSettings.mockResolvedValue(persistedSettings)

    await usePreferencesStore
      .getState()
      .setShortcutBinding('terminal.toggle', { key: '  j  ', mod: true })

    expect(apiMock.getSettings).toHaveBeenCalledOnce()
    expect(usePreferencesStore.getState().settings).toEqual(persistedSettings)
  })
})
