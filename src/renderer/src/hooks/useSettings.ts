import { useEffect } from 'react'
import { api } from '@/lib/ipc'
import { useSettingsStore } from '@/stores/settings-store'

/**
 * Load settings and provider models on mount. Call once at the app root.
 */
export function useSettingsSetup(): void {
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadProviderModels = useSettingsStore((s) => s.loadProviderModels)
  const loadAllAuthAccounts = useSettingsStore((s) => s.loadAllAuthAccounts)

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
        useSettingsStore.setState((state) => ({
          oauthStatuses: { ...state.oauthStatuses, [status.provider]: status },
        }))
      }
    })
  }, [])
}

/**
 * Hook for settings UI — uses granular selectors to avoid unnecessary re-renders.
 */
export function useSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const isLoaded = useSettingsStore((s) => s.isLoaded)
  const loadError = useSettingsStore((s) => s.loadError)
  const testingProviders = useSettingsStore((s) => s.testingProviders)
  const testResults = useSettingsStore((s) => s.testResults)
  const providerModels = useSettingsStore((s) => s.providerModels)
  const updateApiKey = useSettingsStore((s) => s.updateApiKey)
  const toggleProvider = useSettingsStore((s) => s.toggleProvider)
  const updateBaseUrl = useSettingsStore((s) => s.updateBaseUrl)
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel)
  const toggleFavoriteModel = useSettingsStore((s) => s.toggleFavoriteModel)
  const setProjectPath = useSettingsStore((s) => s.setProjectPath)
  const setExecutionMode = useSettingsStore((s) => s.setExecutionMode)
  const setQualityPreset = useSettingsStore((s) => s.setQualityPreset)
  const setBrowserHeadless = useSettingsStore((s) => s.setBrowserHeadless)
  const pushRecentProject = useSettingsStore((s) => s.pushRecentProject)
  const testApiKey = useSettingsStore((s) => s.testApiKey)
  const clearTestResult = useSettingsStore((s) => s.clearTestResult)
  const retryLoad = useSettingsStore((s) => s.retryLoad)
  const oauthStatuses = useSettingsStore((s) => s.oauthStatuses)
  const authAccounts = useSettingsStore((s) => s.authAccounts)
  const startOAuth = useSettingsStore((s) => s.startOAuth)
  const submitAuthCode = useSettingsStore((s) => s.submitAuthCode)
  const disconnectAuth = useSettingsStore((s) => s.disconnectAuth)

  return {
    settings,
    isLoaded,
    loadError,
    testingProviders,
    testResults,
    providerModels,
    updateApiKey,
    toggleProvider,
    updateBaseUrl,
    setDefaultModel,
    toggleFavoriteModel,
    setProjectPath,
    setExecutionMode,
    setQualityPreset,
    setBrowserHeadless,
    pushRecentProject,
    testApiKey,
    clearTestResult,
    retryLoad,
    oauthStatuses,
    authAccounts,
    startOAuth,
    submitAuthCode,
    disconnectAuth,
  }
}
