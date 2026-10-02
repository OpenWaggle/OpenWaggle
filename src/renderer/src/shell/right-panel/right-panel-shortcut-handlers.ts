import {
  closeRightPanel,
  hasRightPanelController,
  type RightPanelSurfaceId,
  toggleRightPanel,
  toggleRightPanelSurface,
} from '@/shared/lib/right-panel-surfaces'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import {
  closeWorkspaceRightPanel,
  hasActiveWorkspaceRightPanel,
  toggleWorkspacePanelMaximized,
  toggleWorkspaceRightPanel,
} from '../workspace-panel-actions'

/**
 * Right panel shortcut handlers. Chat routes route them through the Right panel controller
 * (ADR 0043); elsewhere the workspace panel keeps its previous behaviour.
 */
export const OPEN_A_SESSION_FIRST = 'Open a session first'

/** Off a Session chat page there is no Panel rail, so the shortcut says why nothing opened. */
export function toggleOnChatPage(
  id: RightPanelSurfaceId,
  showToast: (message: string, type: 'error') => void,
) {
  if (hasRightPanelController()) toggleRightPanelSurface(id)
  else showToast(OPEN_A_SESSION_FIRST, 'error')
}

export function rightPanelShortcutHandlers(input: {
  readonly ownerKey: string
  readonly newSideTerminal: () => void
  readonly showToast: (message: string, type: 'error') => void
}) {
  return {
    'rightPanel.toggle': () => {
      if (hasRightPanelController()) {
        toggleRightPanel()
        return
      }
      if (!toggleWorkspaceRightPanel(input.ownerKey)) input.newSideTerminal()
    },
    'rightPanel.toggleMaximized': () => {
      if (!toggleWorkspacePanelMaximized(input.ownerKey)) {
        input.showToast('Open a panel first.', 'error')
      }
    },
    'rightPanel.close': () => {
      if (hasRightPanelController()) closeRightPanel()
      else closeWorkspaceRightPanel(input.ownerKey)
    },
    'rightPanel.allPanels': () => toggleOnChatPage('all-panels', input.showToast),
    'rightPanel.projectActions': () => toggleOnChatPage('project-actions', input.showToast),
    'rightPanel.files': () => toggleOnChatPage('files', input.showToast),
    'rightPanel.resources': () => toggleOnChatPage('resources', input.showToast),
  }
}

/** Mod+W closes the Right panel only while one is shown. */
export function rightPanelCloseIsActive(ownerKey: string) {
  return hasRightPanelController()
    ? useRightSidebarCoordinator.getState().activeClaim !== null
    : hasActiveWorkspaceRightPanel(ownerKey)
}
