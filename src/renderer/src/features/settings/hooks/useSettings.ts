import type { OAuthProvider } from '@shared/types/auth'
import type { Settings } from '@shared/types/settings'
import { useCallback, useEffect, useState } from 'react'
import { useAuthStore, useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state/preferences-store'
import { useSyntaxThemeCatalogStore } from '@/features/settings/state/syntax-theme-store'
import { api } from '@/shared/lib/ipc'

interface ProviderCatalogLoaders {
  readonly loadProviderModels: (settings: Settings) => Promise<Settings | null>
  readonly loadAllAuthAccounts: (providers: readonly OAuthProvider[]) => Promise<void>
  readonly isActive: () => boolean
}

/**
 * Loads the Pi provider catalog for the loaded settings, keeps the selection it repaired, then
 * loads the accounts of its sign-in providers. Startup and the provider catalog retry share it.
 * Only the repaired selection is merged back, since settings may have changed while it loaded.
 */
async function hydrateProviderCatalog(loaders: ProviderCatalogLoaders) {
  const updatedSettings = await loaders.loadProviderModels(usePreferencesStore.getState().settings)
  if (!loaders.isActive()) return

  if (updatedSettings) {
    const { selectedModel } = updatedSettings
    usePreferencesStore.setState((state) => ({ settings: { ...state.settings, selectedModel } }))
  }

  const oauthProviders = useProviderStore
    .getState()
    .providerModels.flatMap((provider) => (provider.auth.supportsOAuth ? [provider.provider] : []))
  await loaders.loadAllAuthAccounts(oauthProviders)
}

/**
 * Load settings and provider models on mount. Call once at the app root.
 */
export function useSettingsSetup(): () => void {
  const loadSettings = usePreferencesStore((s) => s.loadSettings)
  const loadSyntaxThemeCatalog = useSyntaxThemeCatalogStore((s) => s.load)
  const loadProviderModels = useProviderStore((s) => s.loadProviderModels)
  const loadAllAuthAccounts = useAuthStore((s) => s.loadAllAuthAccounts)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    usePreferencesStore.setState({ isLoaded: false, loadError: null })
    setAttempt((current) => current + 1)
  }, [])

  useEffect(() => {
    let active = true

    async function initialize() {
      if (attempt === 0) {
        await loadSyntaxThemeCatalog(null)
        if (!active) return
      }

      await loadSettings()
      if (!active) return
      if (usePreferencesStore.getState().loadError !== null) return

      await hydrateProviderCatalog({
        loadProviderModels,
        loadAllAuthAccounts,
        isActive: () => active,
      })
    }

    void initialize()

    return () => {
      active = false
    }
  }, [attempt, loadSyntaxThemeCatalog, loadSettings, loadProviderModels, loadAllAuthAccounts])

  // Subscribe to OAuth status events from main process (per-provider)
  useEffect(() => {
    return api.onOAuthStatus((status) => {
      // Only update for statuses that include a provider
      if ('provider' in status) {
        useAuthStore.setState((state) => ({
          oauthStatuses: { ...state.oauthStatuses, [status.provider]: status },
        }))
      }
    })
  }, [])

  return retry
}

/**
 * Retries a provider catalog that failed to load while settings loaded, through the same steps as
 * startup: the catalog for the current settings, then the sign-in accounts it lists. Resolves to
 * whether the catalog loaded.
 */
export function useProviderCatalogRetry(): () => Promise<boolean> {
  const loadProviderModels = useProviderStore((s) => s.loadProviderModels)
  const loadAllAuthAccounts = useAuthStore((s) => s.loadAllAuthAccounts)

  return async () => {
    await hydrateProviderCatalog({ loadProviderModels, loadAllAuthAccounts, isActive: () => true })
    return useProviderStore.getState().loadError === null
  }
}

/**
 * Preferences-only hook — settings, load state, and preference actions.
 * Does NOT subscribe to provider or auth stores.
 */
export function usePreferences() {
  const settings = usePreferencesStore((s) => s.settings)
  const isLoaded = usePreferencesStore((s) => s.isLoaded)
  const loadError = usePreferencesStore((s) => s.loadError)
  const setSelectedModel = usePreferencesStore((s) => s.setSelectedModel)
  const toggleFavoriteModel = usePreferencesStore((s) => s.toggleFavoriteModel)
  const setEnabledModels = usePreferencesStore((s) => s.setEnabledModels)
  const setProjectPath = usePreferencesStore((s) => s.setProjectPath)
  const pushRecentProject = usePreferencesStore((s) => s.pushRecentProject)

  return {
    settings,
    isLoaded,
    loadError,
    setSelectedModel,
    toggleFavoriteModel,
    setEnabledModels,
    setProjectPath,
    pushRecentProject,
  }
}

/**
 * Provider-only hook — model lists, API testing, provider config actions.
 * Does NOT subscribe to preferences or auth stores.
 */
export function useProviders() {
  const isLoading = useProviderStore((s) => s.isLoading)
  const loadError = useProviderStore((s) => s.loadError)
  const testingProviders = useProviderStore((s) => s.testingProviders)
  const testResults = useProviderStore((s) => s.testResults)
  const providerModels = useProviderStore((s) => s.providerModels)
  const updateApiKey = useProviderStore((s) => s.updateApiKey)
  const testApiKey = useProviderStore((s) => s.testApiKey)
  const clearTestResult = useProviderStore((s) => s.clearTestResult)

  return {
    isLoading,
    loadError,
    testingProviders,
    testResults,
    providerModels,
    updateApiKey,
    testApiKey,
    clearTestResult,
  }
}

/**
 * Auth-only hook — OAuth flow status and connected accounts.
 * Does NOT subscribe to preferences or provider stores.
 */
export function useAuth() {
  const oauthStatuses = useAuthStore((s) => s.oauthStatuses)
  const authAccounts = useAuthStore((s) => s.authAccounts)
  const startOAuth = useAuthStore((s) => s.startOAuth)
  const submitAuthCode = useAuthStore((s) => s.submitAuthCode)
  const cancelOAuth = useAuthStore((s) => s.cancelOAuth)
  const disconnectAuth = useAuthStore((s) => s.disconnectAuth)

  return {
    oauthStatuses,
    authAccounts,
    startOAuth,
    submitAuthCode,
    cancelOAuth,
    disconnectAuth,
  }
}
