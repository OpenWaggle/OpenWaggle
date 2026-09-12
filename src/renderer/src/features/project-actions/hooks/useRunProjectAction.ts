import type { ProjectAction } from '@shared/types/project-actions'
import { useChat } from '@/features/chat/hooks'
import {
  getTerminalActivityStatus,
  getTerminalProjectActionPending,
  resolveTerminalCommandLayoutOwner,
  terminalInputDispatcher,
  terminalOwnerContext,
  useTerminalStore,
} from '@/features/terminal'
import { useUIStore } from '@/shell/ui-store'
import { openWorkspacePreview, showWorkspaceSideTerminal } from '@/shell/workspace-panel-actions'
import {
  executeProjectAction,
  type ProjectActionRunDependencies,
} from '../lib/project-action-runner'
import { useProjectActionStore } from '../state/project-action-store'

export function projectActionWorktreeMode(
  session: {
    readonly environmentMode?: 'local' | 'worktree'
    readonly worktreePath?: string | null
  } | null,
) {
  return (
    session?.environmentMode === 'worktree' &&
    session.worktreePath !== null &&
    session.worktreePath !== undefined &&
    session.worktreePath.trim().length > 0
  )
}

function runDependencies(): ProjectActionRunDependencies {
  return {
    terminalSnapshot: () => {
      const state = useTerminalStore.getState()
      return { groups: state.groups, exits: state.exits }
    },
    resolveLayoutOwner: resolveTerminalCommandLayoutOwner,
    getActivityStatus: getTerminalActivityStatus,
    getProjectActionPending: getTerminalProjectActionPending,
    hasPendingInputAction: (ownerKey, terminalId) =>
      terminalInputDispatcher.hasPendingProjectAction(ownerKey, terminalId),
    createTerminal: (layoutOwnerKey, cwd, launchEnv) =>
      useTerminalStore.getState().createTerminal(layoutOwnerKey, cwd, launchEnv),
    setPaneLaunchEnv: (layoutOwnerKey, terminalId, launchEnv) =>
      useTerminalStore.getState().setPaneLaunchEnv(layoutOwnerKey, terminalId, launchEnv),
    setPanelOpen: (layoutOwnerKey) =>
      useTerminalStore.getState().setPanelOpen(layoutOwnerKey, true),
    showSideTerminal: showWorkspaceSideTerminal,
    acquireInput: (ownerKey, terminalId) => terminalInputDispatcher.acquire(ownerKey, terminalId),
    openPreview: openWorkspacePreview,
  }
}

export function useRunProjectAction(projectPath: string | null) {
  const { activeSession } = useChat()
  const showToast = useUIStore((state) => state.showToast)
  const rememberInvoked = useProjectActionStore((state) => state.rememberInvoked)
  const owner = terminalOwnerContext(activeSession, projectPath)

  return async (action: ProjectAction) => {
    if (projectPath === null || owner.defaultCwd === null) {
      showToast('Open a project before running an action.', 'error')
      return false
    }
    try {
      const result = await executeProjectAction(
        action,
        {
          projectPath,
          ownerKey: owner.ownerKey,
          workingPath: owner.defaultCwd,
          worktreeMode: projectActionWorktreeMode(activeSession),
        },
        runDependencies(),
      )
      rememberInvoked(projectPath, action.id)
      if (result.previewError !== null) {
        showToast(`Action started, but preview failed: ${result.previewError.message}`, 'error')
      }
      return true
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : `Could not run action “${action.name}”.`,
        'error',
      )
      return false
    }
  }
}
