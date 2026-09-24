import type { ActionManagementScope } from '@shared/types/action-management'
import type { ActionRun } from '@shared/types/action-runs'
import { useEffect } from 'react'
import { useUIStore } from '@/shell/ui-store'
import { openWorkspacePreview } from '@/shell/workspace-panel-actions'
import { useProjectActionStore } from '../state/project-action-store'

export function useActionPreview(scope: ActionManagementScope | null, runs: readonly ActionRun[]) {
  const sessionId = scope?.sessionId
  useEffect(() => {
    if (!sessionId) return
    for (const run of runs) {
      if (!run.ready || !run.previewUrl || run.status !== 'running' || !run.action.autoOpenPreview)
        continue
      const preferences = useProjectActionStore.getState()
      if (preferences.previewOpenedRuns.includes(run.id)) continue
      preferences.rememberPreviewOpened(run.id)
      void Promise.resolve()
        .then(() => openWorkspacePreview(sessionId, run.previewUrl ?? ''))
        .catch((error: unknown) => {
          useUIStore
            .getState()
            .showToast(
              error instanceof Error
                ? error.message
                : 'Could not open action preview. Use Open preview to retry.',
              'error',
            )
        })
    }
  }, [sessionId, runs])
}
