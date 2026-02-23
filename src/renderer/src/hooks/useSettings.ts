import { useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'

/**
 * Load settings and provider models on mount. Call once at the app root.
 */
export function useSettingsSetup(): void {
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadProviderModels = useSettingsStore((s) => s.loadProviderModels)

  useEffect(() => {
    loadSettings()
    loadProviderModels()
  }, [loadSettings, loadProviderModels])
}

/**
 * Hook for settings UI — uses granular selectors to avoid unnecessary re-renders.
 */
export function useSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const isLoaded = useSettingsStore((s) => s.isLoaded)
  const testingProviders = useSettingsStore((s) => s.testingProviders)
  const testResults = useSettingsStore((s) => s.testResults)
  const providerModels = useSettingsStore((s) => s.providerModels)
  const updateApiKey = useSettingsStore((s) => s.updateApiKey)
  const toggleProvider = useSettingsStore((s) => s.toggleProvider)
  const updateBaseUrl = useSettingsStore((s) => s.updateBaseUrl)
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel)
  const setProjectPath = useSettingsStore((s) => s.setProjectPath)
  const setExecutionMode = useSettingsStore((s) => s.setExecutionMode)
  const setQualityPreset = useSettingsStore((s) => s.setQualityPreset)
  const setBrowserHeadless = useSettingsStore((s) => s.setBrowserHeadless)
  const pushRecentProject = useSettingsStore((s) => s.pushRecentProject)
  const testApiKey = useSettingsStore((s) => s.testApiKey)
  const clearTestResult = useSettingsStore((s) => s.clearTestResult)

  return {
    settings,
    isLoaded,
    testingProviders,
    testResults,
    providerModels,
    updateApiKey,
    toggleProvider,
    updateBaseUrl,
    setDefaultModel,
    setProjectPath,
    setExecutionMode,
    setQualityPreset,
    setBrowserHeadless,
    pushRecentProject,
    testApiKey,
    clearTestResult,
  }
}
