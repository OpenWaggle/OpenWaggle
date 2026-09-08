import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  loadSettingsMock,
  loadSyntaxThemeCatalogMock,
  loadProviderModelsMock,
  loadAllAuthAccountsMock,
  onOAuthStatusMock,
  setPreferencesStateMock,
  unsubscribeMock,
} = vi.hoisted(() => ({
  loadSettingsMock: vi.fn(),
  loadSyntaxThemeCatalogMock: vi.fn(),
  loadProviderModelsMock: vi.fn(),
  loadAllAuthAccountsMock: vi.fn(),
  onOAuthStatusMock: vi.fn(),
  setPreferencesStateMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}))

let preferencesLoadError: string | null = null

function selectPreferences<T>(selector: (state: { loadSettings: typeof loadSettingsMock }) => T) {
  return selector({ loadSettings: loadSettingsMock })
}

function selectSyntaxThemeCatalog<T>(
  selector: (state: { load: typeof loadSyntaxThemeCatalogMock }) => T,
) {
  return selector({ load: loadSyntaxThemeCatalogMock })
}

function selectProviders<T>(
  selector: (state: {
    loadProviderModels: typeof loadProviderModelsMock
    providerModels: Array<{ provider: string; auth: { supportsOAuth: boolean } }>
  }) => T,
) {
  return selector({
    loadProviderModels: loadProviderModelsMock,
    providerModels: [
      { provider: 'openai-codex', auth: { supportsOAuth: true } },
      { provider: 'local-provider', auth: { supportsOAuth: false } },
      { provider: 'github-copilot', auth: { supportsOAuth: true } },
    ],
  })
}

function getProviderState() {
  return {
    loadProviderModels: loadProviderModelsMock,
    providerModels: [
      { provider: 'openai-codex', auth: { supportsOAuth: true } },
      { provider: 'local-provider', auth: { supportsOAuth: false } },
      { provider: 'github-copilot', auth: { supportsOAuth: true } },
    ],
  }
}

function getPreferencesState() {
  return {
    loadError: preferencesLoadError,
    settings: {
      projectPath: null,
    },
  }
}

function selectAuth<T>(
  selector: (state: { loadAllAuthAccounts: typeof loadAllAuthAccountsMock }) => T,
) {
  return selector({ loadAllAuthAccounts: loadAllAuthAccountsMock })
}

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    onOAuthStatus: onOAuthStatusMock,
  },
}))

vi.mock('@/features/settings/state/preferences-store', () => ({
  usePreferencesStore: Object.assign(selectPreferences, {
    getState: getPreferencesState,
    setState: setPreferencesStateMock,
  }),
}))

vi.mock('@/features/settings/state/syntax-theme-store', () => ({
  useSyntaxThemeCatalogStore: selectSyntaxThemeCatalog,
}))

vi.mock('@/features/providers/state/provider-store', () => ({
  useProviderStore: Object.assign(selectProviders, {
    getState: getProviderState,
  }),
}))

vi.mock('@/features/providers/state/auth-store', () => ({
  useAuthStore: selectAuth,
}))

import { useSettingsSetup } from '../useSettings'

describe('useSettingsSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    preferencesLoadError = null
    loadSyntaxThemeCatalogMock.mockResolvedValue(undefined)
    loadSettingsMock.mockResolvedValue(undefined)
    loadProviderModelsMock.mockResolvedValue(undefined)
    loadAllAuthAccountsMock.mockResolvedValue(undefined)
    onOAuthStatusMock.mockReturnValue(unsubscribeMock)
  })

  it('registers imported syntax resources before loading saved appearance settings', async () => {
    let resolveSyntaxCatalog = () => {}
    loadSyntaxThemeCatalogMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSyntaxCatalog = resolve
      }),
    )

    renderHook(() => useSettingsSetup())

    expect(loadSyntaxThemeCatalogMock).toHaveBeenCalledWith(null)
    expect(loadSettingsMock).not.toHaveBeenCalled()

    resolveSyntaxCatalog()

    await waitFor(() => {
      expect(loadSettingsMock).toHaveBeenCalledOnce()
    })
  })

  it('waits for settings before loading provider models and auth accounts', async () => {
    let resolveSettings = () => {}
    loadSettingsMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSettings = resolve
      }),
    )

    renderHook(() => useSettingsSetup())

    await waitFor(() => {
      expect(loadSettingsMock).toHaveBeenCalledOnce()
    })
    expect(loadProviderModelsMock).not.toHaveBeenCalled()
    expect(loadAllAuthAccountsMock).not.toHaveBeenCalled()

    resolveSettings()

    await waitFor(() => {
      expect(loadProviderModelsMock).toHaveBeenCalledOnce()
      expect(loadAllAuthAccountsMock).toHaveBeenCalledOnce()
      expect(loadAllAuthAccountsMock).toHaveBeenCalledWith(['openai-codex', 'github-copilot'])
    })
  })

  it('does not load providers or auth from fallback settings after a settings read failure', async () => {
    preferencesLoadError = 'settings database unavailable'

    renderHook(() => useSettingsSetup())

    await waitFor(() => {
      expect(loadSettingsMock).toHaveBeenCalledOnce()
    })
    expect(loadProviderModelsMock).not.toHaveBeenCalled()
    expect(loadAllAuthAccountsMock).not.toHaveBeenCalled()
  })

  it('retries the complete settings dependency chain in place after recovery', async () => {
    preferencesLoadError = 'settings database unavailable'
    const { result } = renderHook(() => useSettingsSetup())
    await waitFor(() => expect(loadSettingsMock).toHaveBeenCalledOnce())

    preferencesLoadError = null
    act(() => result.current())

    await waitFor(() => {
      expect(loadSettingsMock).toHaveBeenCalledTimes(2)
      expect(loadProviderModelsMock).toHaveBeenCalledOnce()
      expect(loadAllAuthAccountsMock).toHaveBeenCalledOnce()
    })
    expect(setPreferencesStateMock).toHaveBeenCalledWith({ isLoaded: false, loadError: null })
  })

  it('registers and cleans up the OAuth status listener', () => {
    const { unmount } = renderHook(() => useSettingsSetup())

    expect(onOAuthStatusMock).toHaveBeenCalledOnce()

    unmount()

    expect(unsubscribeMock).toHaveBeenCalledOnce()
  })
})
