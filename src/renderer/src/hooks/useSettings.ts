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
 * Hook for settings UI.
 */
export function useSettings() {
  const store = useSettingsStore()

  return {
    settings: store.settings,
    isLoaded: store.isLoaded,
    isTestingKey: store.isTestingKey,
    testResult: store.testResult,
    updateApiKey: store.updateApiKey,
    setDefaultModel: store.setDefaultModel,
    setProjectPath: store.setProjectPath,
    testApiKey: store.testApiKey,
    clearTestResult: store.clearTestResult,
  }
}
