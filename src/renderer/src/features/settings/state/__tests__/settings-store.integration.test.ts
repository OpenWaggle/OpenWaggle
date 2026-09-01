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
  },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

import { usePreferencesStore } from '../preferences-store'

function deferred<T>() {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

describe('preferences-store integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getSettings.mockResolvedValue(DEFAULT_SETTINGS)
    apiMock.getProviderModels.mockResolvedValue([])
    apiMock.setProviderApiKey.mockResolvedValue(undefined)
    apiMock.setEnabledModels.mockResolvedValue(undefined)
    apiMock.updateSettings.mockResolvedValue({ ok: true })
    usePreferencesStore.setState({
      settings: DEFAULT_SETTINGS,
      persistedAppearancePreferences: DEFAULT_SETTINGS.appearancePreferences,
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

  it('persists typography as one appearance preference document', async () => {
    await usePreferencesStore.getState().setAppearanceTypography({
      codeFontFamily: 'JetBrains Mono, monospace',
      codeFontSize: 14,
    })

    expect(apiMock.updateSettings).toHaveBeenCalledWith({
      appearancePreferences: {
        ...DEFAULT_SETTINGS.appearancePreferences,
        typography: {
          ...DEFAULT_SETTINGS.appearancePreferences.typography,
          codeFontFamily: 'JetBrains Mono, monospace',
          codeFontSize: 14,
        },
      },
    })
    expect(
      usePreferencesStore.getState().settings.appearancePreferences.typography.codeFontSize,
    ).toBe(14)
  })

  it('rolls back optimistic appearance state when persistence is rejected', async () => {
    apiMock.updateSettings.mockResolvedValueOnce({ ok: false, error: 'Appearance rejected.' })

    await expect(
      usePreferencesStore.getState().setAppearanceTypography({ codeFontSize: 18 }),
    ).rejects.toThrow('Appearance rejected.')

    expect(usePreferencesStore.getState().settings.appearancePreferences).toEqual(
      DEFAULT_SETTINGS.appearancePreferences,
    )
  })

  it('rolls back queued appearance failures to the last persisted preferences', async () => {
    apiMock.updateSettings
      .mockResolvedValueOnce({ ok: false, error: 'First appearance rejected.' })
      .mockResolvedValueOnce({ ok: false, error: 'Second appearance rejected.' })

    const firstWrite = usePreferencesStore.getState().setAppearanceTypography({ codeFontSize: 13 })
    const secondWrite = usePreferencesStore.getState().setAppearanceTypography({ codeFontSize: 14 })

    await Promise.all([
      expect(firstWrite).rejects.toThrow('First appearance rejected.'),
      expect(secondWrite).rejects.toThrow('Second appearance rejected.'),
    ])
    expect(usePreferencesStore.getState().settings.appearancePreferences).toEqual(
      DEFAULT_SETTINGS.appearancePreferences,
    )
  })

  it('preserves an appearance update when an older settings write completes later', async () => {
    const diffWrite = deferred<{ ok: true }>()
    apiMock.updateSettings.mockImplementation((patch: { diffView?: unknown }) =>
      patch.diffView ? diffWrite.promise : Promise.resolve({ ok: true }),
    )

    const pendingDiffWrite = usePreferencesStore.getState().setDiffView('split')
    await vi.waitFor(() =>
      expect(apiMock.updateSettings).toHaveBeenCalledWith({ diffView: 'split' }),
    )
    await usePreferencesStore.getState().setAppearanceTypography({ codeFontSize: 14 })
    diffWrite.resolve({ ok: true })
    await pendingDiffWrite

    expect(usePreferencesStore.getState().settings).toMatchObject({
      diffView: 'split',
      appearancePreferences: {
        typography: { codeFontSize: 14 },
      },
    })
  })

  it('does not change the syntax theme when persistence is rejected', async () => {
    apiMock.updateSettings.mockResolvedValueOnce({ ok: false, error: 'Theme rejected.' })

    await expect(
      usePreferencesStore.getState().setSyntaxTheme('dark', 'dark-plus'),
    ).rejects.toThrow('Theme rejected.')

    expect(usePreferencesStore.getState().settings.syntaxThemeSelections).toEqual(
      DEFAULT_SETTINGS.syntaxThemeSelections,
    )
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
