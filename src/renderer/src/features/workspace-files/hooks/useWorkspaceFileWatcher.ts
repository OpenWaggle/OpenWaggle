import { useEffect, useEffectEvent } from 'react'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'

export function useWorkspaceFileWatcher(
  projectPath: string | null,
  refreshAllWatchedQueries: () => Promise<void>,
) {
  const showToast = useUIStore((state) => state.showToast)
  const refreshFromEvent = useEffectEvent(refreshAllWatchedQueries)
  const reportError = useEffectEvent((error: unknown) => {
    showToast(error instanceof Error ? error.message : String(error), 'error')
  })

  useEffect(() => {
    if (!projectPath) return
    let active = true
    let canonicalProjectPath = projectPath
    const unsubscribe = api.onWorkspaceFilesChanged((event) => {
      if (event.workingPath === canonicalProjectPath) void refreshFromEvent()
    })
    void api.watchWorkspaceFiles(projectPath).then(
      (canonical) => {
        canonicalProjectPath = canonical
      },
      (error: unknown) => {
        if (active) reportError(error)
      },
    )
    return () => {
      active = false
      unsubscribe()
      void api.unwatchWorkspaceFiles(projectPath)
    }
  }, [projectPath])
}
