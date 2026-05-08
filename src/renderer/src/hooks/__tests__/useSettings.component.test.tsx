import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  loadSettingsMock,
  loadProviderModelsMock,
  loadAllAuthAccountsMock,
  onOAuthStatusMock,
  setPreferencesStateMock,
  unsubscribeMock,
} = vi.hoisted(() => ({
  loadSettingsMock: vi.fn(),
  loadProviderModelsMock: vi.fn(),
  loadAllAuthAccountsMock: vi.fn(),
  onOAuthStatusMock: vi.fn(),
  setPreferencesStateMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}))

function selectPreferences<T>(
  selector: (state: { loadSettings: typeof loadSettingsMock }) => T,
): T {
  return selector({ loadSettings: loadSettingsMock })
}

function selectProviders<T>(
  selector: (state: {
    loadProviderModels: typeof loadProviderModelsMock
    providerModels: Array<{ provider: string; auth: { supportsOAuth: boolean } }>
  }) => T,
): T {
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
): T {
  return selector({ loadAllAuthAccounts: loadAllAuthAccountsMock })
}

vi.mock('@/lib/ipc', () => ({
  api: {
    onOAuthStatus: onOAuthStatusMock,
  },
}))

vi.mock('@/stores/preferences-store', () => ({
  usePreferencesStore: Object.assign(selectPreferences, {
    getState: getPreferencesState,
    setState: setPreferencesStateMock,
  }),
}))

vi.mock('@/stores/provider-store', () => ({
  useProviderStore: Object.assign(selectProviders, {
    getState: getProviderState,
  }),
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: selectAuth,
}))

import { useSettingsSetup } from '../useSettings'

describe('useSettingsSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadSettingsMock.mockResolvedValue(undefined)
    loadProviderModelsMock.mockResolvedValue(undefined)
    loadAllAuthAccountsMock.mockResolvedValue(undefined)
    onOAuthStatusMock.mockReturnValue(unsubscribeMock)
  })

  it('waits for settings before loading provider models and auth accounts', async () => {
    let resolveSettings = () => {}
    loadSettingsMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSettings = resolve
      }),
    )

    renderHook(() => useSettingsSetup())

    expect(loadSettingsMock).toHaveBeenCalledOnce()
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
