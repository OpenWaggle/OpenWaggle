import { useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'

/**
 * Load settings on mount. Call once at the app root.
 */
export function useSettingsSetup(): void {
  const loadSettings = useSettingsStore((s) => s.loadSettings)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])
}

/**
 * Hook for settings UI — uses granular selectors to avoid unnecessary re-renders.
 */
export function useSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const isLoaded = useSettingsStore((s) => s.isLoaded)
  const isTestingKey = useSettingsStore((s) => s.isTestingKey)
  const testResult = useSettingsStore((s) => s.testResult)
  const updateApiKey = useSettingsStore((s) => s.updateApiKey)
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel)
  const setProjectPath = useSettingsStore((s) => s.setProjectPath)
  const testApiKey = useSettingsStore((s) => s.testApiKey)
  const clearTestResult = useSettingsStore((s) => s.clearTestResult)

  return {
    settings,
    isLoaded,
    isTestingKey,
    testResult,
    updateApiKey,
    setDefaultModel,
    setProjectPath,
    testApiKey,
    clearTestResult,
  }
}
