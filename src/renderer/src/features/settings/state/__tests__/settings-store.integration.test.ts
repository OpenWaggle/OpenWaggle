import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { testHexColor } from '@/test-utils/test-color'

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

  it('persists browser defaults through independent typed settings patches', async () => {
    await usePreferencesStore.getState().setBrowserDefaultViewport({
      mode: 'fixed',
      width: 390,
      height: 844,
      presetId: null,
    })
    await usePreferencesStore.getState().setBrowserDefaultZoomFactor(1.25)
    await usePreferencesStore.getState().setBrowserDefaultAppearance('dark')
    await usePreferencesStore.getState().setBrowserRecordingFrameRate(60)
    await usePreferencesStore.getState().setBrowserAutoShowFloatingPreview(false)

    expect(apiMock.updateSettings.mock.calls.slice(-5)).toEqual([
      [
        {
          browserDefaultViewport: {
            mode: 'fixed',
            width: 390,
            height: 844,
            presetId: null,
          },
        },
      ],
      [{ browserDefaultZoomFactor: 1.25 }],
      [{ browserDefaultAppearance: 'dark' }],
      [{ browserRecordingFrameRate: 60 }],
      [{ browserAutoShowFloatingPreview: false }],
    ])
    expect(usePreferencesStore.getState().settings).toMatchObject({
      browserDefaultViewport: { mode: 'fixed', width: 390, height: 844, presetId: null },
      browserDefaultZoomFactor: 1.25,
      browserDefaultAppearance: 'dark',
      browserRecordingFrameRate: 60,
      browserAutoShowFloatingPreview: false,
    })
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

  it('persists terminal palette overrides in the appearance document', async () => {
    const background = testHexColor('111111')
    const selection = testHexColor('33669988')
    await usePreferencesStore.getState().setAppearanceTerminalPalette({
      background,
      selection,
    })

    expect(apiMock.updateSettings).toHaveBeenCalledWith({
      appearancePreferences: {
        ...DEFAULT_SETTINGS.appearancePreferences,
        terminalPalette: {
          ...DEFAULT_SETTINGS.appearancePreferences.terminalPalette,
          background,
          selection,
        },
      },
    })
    expect(usePreferencesStore.getState().settings.appearancePreferences.terminalPalette).toEqual({
      ...DEFAULT_SETTINGS.appearancePreferences.terminalPalette,
      background,
      selection,
    })
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

  it('serializes syntax theme selections without losing another profile update', async () => {
    const firstWrite = deferred<{ ok: true }>()
    apiMock.updateSettings
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce({ ok: true })

    const darkWrite = usePreferencesStore.getState().setSyntaxTheme('dark', 'bundled:nord')
    await vi.waitFor(() => expect(apiMock.updateSettings).toHaveBeenCalledOnce())
    const lightWrite = usePreferencesStore
      .getState()
      .setSyntaxTheme('light', 'bundled:github-light')
    expect(apiMock.updateSettings).toHaveBeenCalledOnce()
    firstWrite.resolve({ ok: true })
    await Promise.all([darkWrite, lightWrite])

    expect(apiMock.updateSettings).toHaveBeenNthCalledWith(2, {
      syntaxThemeSelections: {
        ...DEFAULT_SETTINGS.syntaxThemeSelections,
        dark: 'bundled:nord',
        light: 'bundled:github-light',
      },
    })
    expect(usePreferencesStore.getState().settings.syntaxThemeSelections).toEqual({
      ...DEFAULT_SETTINGS.syntaxThemeSelections,
      dark: 'bundled:nord',
      light: 'bundled:github-light',
    })
  })
})
