import { renderHook, waitFor } from '@testing-library/react'
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

  it('registers and cleans up the OAuth status listener', () => {
    const { unmount } = renderHook(() => useSettingsSetup())

    expect(onOAuthStatusMock).toHaveBeenCalledOnce()

    unmount()

    expect(unsubscribeMock).toHaveBeenCalledOnce()
  })
})
