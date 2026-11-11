import { SupportedModelId } from '@shared/types/brand'
import type { OAuthFlowStatus } from '@shared/types/auth'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore, useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state/preferences-store'
import { useSyntaxThemeCatalogStore } from '@/features/settings/state/syntax-theme-store'

/*
 * Only the preload is replaced: the preferences, Syntax theme, provider and auth stores are the
 * real ones, so each case asserts what the app ends up holding, in the order startup needs.
 */
const ipc = vi.hoisted(() => ({
  getSettings: vi.fn<() => Promise<Settings>>(),
  listSyntaxThemes: vi.fn(),
  getProviderModels: vi.fn<() => Promise<ProviderInfo[]>>(),
  getAuthAccountInfos: vi.fn(),
  updateSettings: vi.fn(),
  oauthListeners: new Set<(status: OAuthFlowStatus) => void>(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSettings: ipc.getSettings,
    listSyntaxThemes: ipc.listSyntaxThemes,
    getProviderModels: ipc.getProviderModels,
    getAuthAccountInfos: ipc.getAuthAccountInfos,
    updateSettings: ipc.updateSettings,
    onOAuthStatus: (listener: (status: OAuthFlowStatus) => void) => {
      ipc.oauthListeners.add(listener)
      return () => ipc.oauthListeners.delete(listener)
    },
  },
}))

import { useProviderCatalogRetry, useSettingsSetup } from '../useSettings'

const CURRENT_MODEL = SupportedModelId('openai-codex/gpt-5.4')
const RETIRED_MODEL = SupportedModelId('openai-codex/gpt-4')

function provider(name: string, supportsOAuth: boolean): ProviderInfo {
  return {
    provider: name,
    displayName: name,
    auth: {
      configured: true,
      source: 'api-key',
      apiKeyConfigured: true,
      apiKeySource: 'api-key',
      oauthConnected: false,
      supportsApiKey: true,
      supportsOAuth,
    },
    models: [CURRENT_MODEL, RETIRED_MODEL]
      .filter((id) => id.startsWith(`${name}/`))
      .map((id) => ({
        id,
        modelId: id.slice(name.length + 1),
        name: id,
        provider: name,
        available: true,
        availableThinkingLevels: ['off'],
      })),
  }
}

const EMPTY_SYNTAX_CATALOG = { themes: [], languages: [], appearances: [] }
const CATALOG = [
  provider('openai-codex', true),
  provider('local-provider', false),
  provider('github-copilot', true),
]
const SAVED_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  selectedModel: CURRENT_MODEL,
  enabledModels: [CURRENT_MODEL],
}

function deferred<T>() {
  return Promise.withResolvers<T>()
}

function emitOAuthStatus(status: OAuthFlowStatus) {
  act(() => {
    for (const listener of ipc.oauthListeners) listener(status)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ipc.oauthListeners.clear()
  usePreferencesStore.setState(usePreferencesStore.getInitialState())
  useSyntaxThemeCatalogStore.setState(useSyntaxThemeCatalogStore.getInitialState())
  useProviderStore.setState(useProviderStore.getInitialState())
  useAuthStore.setState(useAuthStore.getInitialState())
  ipc.getSettings.mockResolvedValue(SAVED_SETTINGS)
  ipc.listSyntaxThemes.mockResolvedValue(EMPTY_SYNTAX_CATALOG)
  ipc.getProviderModels.mockResolvedValue(CATALOG)
  ipc.getAuthAccountInfos.mockImplementation(async (providers: readonly string[]) =>
    Object.fromEntries(
      providers.map((name) => [name, { provider: name, connected: true, label: name }]),
    ),
  )
  ipc.updateSettings.mockResolvedValue(undefined)
})

describe('useSettingsSetup', () => {
  it('reads settings while the Syntax theme catalog loads, then loads providers and their accounts (B11)', async () => {
    const catalog = deferred<typeof EMPTY_SYNTAX_CATALOG>()
    ipc.listSyntaxThemes.mockReturnValue(catalog.promise)

    renderHook(() => useSettingsSetup())

    // In flight at once, but applied only after the catalog registered the themes it may select.
    expect(ipc.getSettings).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(usePreferencesStore.getState().settings).toBe(DEFAULT_SETTINGS)
    expect(ipc.getProviderModels).not.toHaveBeenCalled()

    await act(async () => catalog.resolve(EMPTY_SYNTAX_CATALOG))

    await waitFor(() => expect(Object.keys(useAuthStore.getState().authAccounts)).toHaveLength(2))
    expect(usePreferencesStore.getState()).toMatchObject({
      settings: SAVED_SETTINGS,
      isLoaded: true,
      loadError: null,
    })
    expect(useProviderStore.getState().providerModels.map((group) => group.provider)).toEqual([
      'openai-codex',
      'local-provider',
      'github-copilot',
    ])
    // Accounts only for the providers that sign in.
    expect(useAuthStore.getState().authAccounts).toEqual({
      'openai-codex': { provider: 'openai-codex', connected: true, label: 'openai-codex' },
      'github-copilot': { provider: 'github-copilot', connected: true, label: 'github-copilot' },
    })
    expect(ipc.getSettings).toHaveBeenCalledOnce()
  })

  it('loads no providers or accounts from fallback settings after the settings read fails', async () => {
    ipc.getSettings.mockRejectedValue(new Error('settings database unavailable'))

    renderHook(() => useSettingsSetup())

    await waitFor(() =>
      expect(usePreferencesStore.getState().loadError).toBe('settings database unavailable'),
    )
    await Promise.resolve()
    expect(ipc.getProviderModels).not.toHaveBeenCalled()
    expect(useAuthStore.getState().authAccounts).toEqual({})
  })

  it('retries the whole chain in place, as often as it is asked', async () => {
    ipc.getSettings.mockRejectedValue(new Error('settings database unavailable'))
    const { result } = renderHook(() => useSettingsSetup())
    await waitFor(() => expect(usePreferencesStore.getState().loadError).not.toBeNull())

    act(() => result.current())
    // The retry shows loading again instead of the old failure.
    expect(usePreferencesStore.getState()).toMatchObject({ isLoaded: false, loadError: null })
    await waitFor(() => expect(usePreferencesStore.getState().loadError).not.toBeNull())

    ipc.getSettings.mockResolvedValue(SAVED_SETTINGS)
    act(() => result.current())

    await waitFor(() => expect(Object.keys(useAuthStore.getState().authAccounts)).toHaveLength(2))
    expect(usePreferencesStore.getState()).toMatchObject({
      settings: SAVED_SETTINGS,
      loadError: null,
    })
    expect(ipc.getSettings).toHaveBeenCalledTimes(3)
    // The catalog loaded on the first attempt is not read again.
    expect(ipc.listSyntaxThemes).toHaveBeenCalledOnce()
  })

  /** Holds one startup read open; returns the step that is reached and the step that releases it. */
  const STAGES = {
    'the Syntax theme catalog': () => {
      const read = deferred<typeof EMPTY_SYNTAX_CATALOG>()
      ipc.listSyntaxThemes.mockReturnValue(read.promise)
      return {
        reached: () => expect(ipc.listSyntaxThemes).toHaveBeenCalled(),
        release: () => read.resolve(EMPTY_SYNTAX_CATALOG),
        // The settings read already in flight is not applied.
        stopped: () => expect(usePreferencesStore.getState().settings).toBe(DEFAULT_SETTINGS),
      }
    },
    settings: () => {
      const read = deferred<Settings>()
      ipc.getSettings.mockReturnValue(read.promise)
      return {
        reached: () => expect(useSyntaxThemeCatalogStore.getState().loadedProjectPath).toBeNull(),
        release: () => read.resolve(SAVED_SETTINGS),
        stopped: () => expect(ipc.getProviderModels).not.toHaveBeenCalled(),
      }
    },
    'the provider catalog': () => {
      const read = deferred<ProviderInfo[]>()
      ipc.getProviderModels.mockReturnValue(read.promise)
      return {
        reached: () => expect(ipc.getProviderModels).toHaveBeenCalled(),
        release: () => read.resolve(CATALOG),
        stopped: () => expect(ipc.getAuthAccountInfos).not.toHaveBeenCalled(),
      }
    },
  }

  it.each(['the Syntax theme catalog', 'settings', 'the provider catalog'] as const)(
    'stops when the app root unmounts while %s loads',
    async (stage) => {
      const { reached, release, stopped } = STAGES[stage]()
      const { unmount } = renderHook(() => useSettingsSetup())
      await waitFor(reached)

      unmount()
      await act(async () => release())
      await act(async () => undefined)

      stopped()
    },
  )

  it('keeps each provider’s sign-in status from the main process until the root unmounts', () => {
    const { unmount } = renderHook(() => useSettingsSetup())

    emitOAuthStatus({ type: 'in-progress', provider: 'openai-codex' })
    emitOAuthStatus({ type: 'success', provider: 'github-copilot' })
    // A status that names no provider belongs to no row.
    emitOAuthStatus({ type: 'in-progress' })

    expect(useAuthStore.getState().oauthStatuses).toEqual({
      'openai-codex': { type: 'in-progress', provider: 'openai-codex' },
      'github-copilot': { type: 'success', provider: 'github-copilot' },
    })

    unmount()
    emitOAuthStatus({ type: 'error', provider: 'openai-codex', message: 'late' })
    expect(useAuthStore.getState().oauthStatuses['openai-codex']).toEqual({
      type: 'in-progress',
      provider: 'openai-codex',
    })
  })
})

describe('useProviderCatalogRetry', () => {
  it('reloads the catalog and its sign-in accounts, and reports whether it loaded', async () => {
    usePreferencesStore.setState({ settings: SAVED_SETTINGS })
    ipc.getProviderModels.mockRejectedValueOnce(new Error('Pi catalog unavailable'))
    const { result } = renderHook(() => useProviderCatalogRetry())

    await expect(act(() => result.current())).resolves.toBe(false)
    expect(useProviderStore.getState().loadError).toBe('Pi catalog unavailable')

    await expect(act(() => result.current())).resolves.toBe(true)
    expect(useProviderStore.getState().loadError).toBeNull()
    expect(Object.keys(useAuthStore.getState().authAccounts).sort()).toEqual([
      'github-copilot',
      'openai-codex',
    ])
    expect(ipc.getSettings).not.toHaveBeenCalled()
  })

  it('merges only the selection the catalog repaired into settings edited meanwhile', async () => {
    usePreferencesStore.setState({
      settings: { ...SAVED_SETTINGS, selectedModel: RETIRED_MODEL },
    })
    const catalog = deferred<ProviderInfo[]>()
    ipc.getProviderModels.mockReturnValue(catalog.promise)
    const { result } = renderHook(() => useProviderCatalogRetry())

    const retried = act(() => result.current())
    usePreferencesStore.setState((state) => ({
      settings: { ...state.settings, projectPath: '/edited' },
    }))
    catalog.resolve(CATALOG)
    await retried

    expect(usePreferencesStore.getState().settings).toMatchObject({
      projectPath: '/edited',
      selectedModel: CURRENT_MODEL,
    })
    expect(ipc.updateSettings).toHaveBeenCalledWith({ selectedModel: CURRENT_MODEL })
  })
})
