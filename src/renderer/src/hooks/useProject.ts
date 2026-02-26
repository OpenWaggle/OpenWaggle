import { api } from '@/lib/ipc'
import { usePreferencesStore } from '@/stores/preferences-store'

/**
 * Hook for project folder selection.
 */
export function useProject() {
  const projectPath = usePreferencesStore((s) => s.settings.projectPath)
  const setProjectPath = usePreferencesStore((s) => s.setProjectPath)

  async function selectFolder() {
    const path = await api.selectProjectFolder()
    if (path) {
      await setProjectPath(path)
    }
    return path
  }

  return {
    projectPath,
    selectFolder,
    setProjectPath,
  }
}
