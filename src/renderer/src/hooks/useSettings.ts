import { useEffect } from 'react'
import { api } from '@/lib/ipc'
import { useAuthStore } from '@/stores/auth-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useProviderStore } from '@/stores/provider-store'

/**
 * Load settings and provider models on mount. Call once at the app root.
 */
export function useSettingsSetup(): void {
  const loadSettings = usePreferencesStore((s) => s.loadSettings)
  const loadProviderModels = useProviderStore((s) => s.loadProviderModels)
  const loadAllAuthAccounts = useAuthStore((s) => s.loadAllAuthAccounts)

  useEffect(() => {
    let active = true

    async function initialize(): Promise<void> {
      await loadSettings()
      if (!active) return

      await loadProviderModels()
      if (!active) return

      const oauthProviders = useProviderStore
        .getState()
        .providerModels.filter((provider) => provider.auth.supportsOAuth)
        .map((provider) => provider.provider)
      await loadAllAuthAccounts(oauthProviders)
    }

    void initialize()

    return () => {
      active = false
    }
  }, [loadSettings, loadProviderModels, loadAllAuthAccounts])

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
  const setThinkingLevel = usePreferencesStore((s) => s.setThinkingLevel)
  const pushRecentProject = usePreferencesStore((s) => s.pushRecentProject)
  const retryLoad = usePreferencesStore((s) => s.retryLoad)

  return {
    settings,
    isLoaded,
    loadError,
    setSelectedModel,
    toggleFavoriteModel,
    setEnabledModels,
    setProjectPath,
    setThinkingLevel,
    pushRecentProject,
    retryLoad,
  }
}

/**
 * Provider-only hook — model lists, API testing, provider config actions.
 * Does NOT subscribe to preferences or auth stores.
 */
export function useProviders() {
  const testingProviders = useProviderStore((s) => s.testingProviders)
  const testResults = useProviderStore((s) => s.testResults)
  const providerModels = useProviderStore((s) => s.providerModels)
  const updateApiKey = useProviderStore((s) => s.updateApiKey)
  const testApiKey = useProviderStore((s) => s.testApiKey)
  const clearTestResult = useProviderStore((s) => s.clearTestResult)

  return {
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
