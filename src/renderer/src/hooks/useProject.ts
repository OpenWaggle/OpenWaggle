import { useCallback } from 'react'
import { api } from '@/lib/ipc'
import { useSettingsStore } from '@/stores/settings-store'

/**
 * Hook for project folder selection.
 */
export function useProject() {
  const projectPath = useSettingsStore((s) => s.settings.projectPath)
  const setProjectPath = useSettingsStore((s) => s.setProjectPath)

  const selectFolder = useCallback(async () => {
    const path = await api.selectProjectFolder()
    if (path) {
      await setProjectPath(path)
    }
    return path
  }, [setProjectPath])

  return {
    projectPath,
    selectFolder,
    setProjectPath,
  }
}
