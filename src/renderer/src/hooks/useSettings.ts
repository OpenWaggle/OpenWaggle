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
    loadSettings()
    loadProviderModels()
    loadAllAuthAccounts()
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
  const setDefaultModel = usePreferencesStore((s) => s.setDefaultModel)
  const toggleFavoriteModel = usePreferencesStore((s) => s.toggleFavoriteModel)
  const setProjectPath = usePreferencesStore((s) => s.setProjectPath)
  const setExecutionMode = usePreferencesStore((s) => s.setExecutionMode)
  const setQualityPreset = usePreferencesStore((s) => s.setQualityPreset)
  const setBrowserHeadless = usePreferencesStore((s) => s.setBrowserHeadless)
  const pushRecentProject = usePreferencesStore((s) => s.pushRecentProject)
  const retryLoad = usePreferencesStore((s) => s.retryLoad)

  return {
    settings,
    isLoaded,
    loadError,
    setDefaultModel,
    toggleFavoriteModel,
    setProjectPath,
    setExecutionMode,
    setQualityPreset,
    setBrowserHeadless,
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
  const modelFetchErrors = useProviderStore((s) => s.modelFetchErrors)
  const updateApiKey = useProviderStore((s) => s.updateApiKey)
  const toggleProvider = useProviderStore((s) => s.toggleProvider)
  const updateBaseUrl = useProviderStore((s) => s.updateBaseUrl)
  const testApiKey = useProviderStore((s) => s.testApiKey)
  const clearTestResult = useProviderStore((s) => s.clearTestResult)

  return {
    testingProviders,
    testResults,
    providerModels,
    modelFetchErrors,
    updateApiKey,
    toggleProvider,
    updateBaseUrl,
    testApiKey,
    clearTestResult,
  }
}

/**
 * Auth-only hook — OAuth flow status and subscription accounts.
 * Does NOT subscribe to preferences or provider stores.
 */
export function useAuth() {
  const oauthStatuses = useAuthStore((s) => s.oauthStatuses)
  const authAccounts = useAuthStore((s) => s.authAccounts)
  const startOAuth = useAuthStore((s) => s.startOAuth)
  const submitAuthCode = useAuthStore((s) => s.submitAuthCode)
  const disconnectAuth = useAuthStore((s) => s.disconnectAuth)

  return {
    oauthStatuses,
    authAccounts,
    startOAuth,
    submitAuthCode,
    disconnectAuth,
  }
}

/**
 * @deprecated Use usePreferences(), useProviders(), or useAuth() directly.
 * Subscribes to all 3 stores — any change triggers re-render.
 */
export function useSettings() {
  return {
    ...usePreferences(),
    ...useProviders(),
    ...useAuth(),
  }
}
