import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'

/** Pure passthrough — defined at module scope so it keeps a stable identity. */
function selectFolder() {
  return api.selectProjectFolder()
}

/**
 * Hook for project folder selection.
 */
export function useProject() {
  const projectPath = usePreferencesStore((s) => s.settings.projectPath)
  const setProjectPath = usePreferencesStore((s) => s.setProjectPath)

  return {
    projectPath,
    selectFolder,
    setProjectPath,
  }
}
