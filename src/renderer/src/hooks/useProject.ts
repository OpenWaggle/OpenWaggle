import { api } from '@/lib/ipc'
import { useSettingsStore } from '@/stores/settings-store'

/**
 * Hook for project folder selection.
 */
export function useProject() {
  const projectPath = useSettingsStore((s) => s.settings.projectPath)
  const setProjectPath = useSettingsStore((s) => s.setProjectPath)

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
