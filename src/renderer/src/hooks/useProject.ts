import { api } from '@/lib/ipc'
import { usePreferencesStore } from '@/stores/preferences-store'

/**
 * Hook for project folder selection.
 */
export function useProject() {
  const projectPath = usePreferencesStore((s) => s.settings.projectPath)
  const setProjectPath = usePreferencesStore((s) => s.setProjectPath)

  async function selectFolder() {
    return api.selectProjectFolder()
  }

  return {
    projectPath,
    selectFolder,
    setProjectPath,
  }
}
