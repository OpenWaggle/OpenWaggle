import type { ActionDefinition } from '@shared/types/action-definitions'
import type { ProjectAction } from '@shared/types/project-actions'
import { actionExecutionKey } from '@shared/utils/action-execution-key'
import { useChat } from '@/features/chat/hooks'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import { openWorkspaceAction } from '@/shell/workspace-panel-actions'
import { useProjectActionStore } from '../state/project-action-store'

export function useRunProjectAction(projectPath: string | null) {
  const { activeSession } = useChat()
  const showToast = useUIStore((state) => state.showToast)
  return async (action: ActionDefinition | ProjectAction) => {
    if (!projectPath || !activeSession || activeSession.projectPath !== projectPath) {
      showToast('Select a session in this project before running an action.', 'error')
      return false
    }
    const expectedExecutionKey =
      'invocation' in action ? actionExecutionKey(action) : action.executionKey
    if (!expectedExecutionKey) {
      showToast('Reload actions before running this shortcut.', 'error')
      return false
    }
    try {
      const result = await api.manageProjectActions({
        scope: { projectPath, sessionId: activeSession.id },
        operation: {
          type: 'start',
          actionId: action.id,
          expectedExecutionKey,
          requestId: crypto.randomUUID(),
        },
      })
      if (result.type !== 'run') throw new Error('Unexpected action start response.')
      useProjectActionStore.getState().rememberInvoked(projectPath, action.id)
      openWorkspaceAction(activeSession.id, projectPath, result.run.id)
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : `Could not run ${action.name}.`, 'error')
      return false
    }
  }
}
