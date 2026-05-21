import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'

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
