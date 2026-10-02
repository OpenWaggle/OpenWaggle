import {
  closeRightPanel,
  hasRightPanelController,
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
        input.showToast(
          'Only Project Actions, Browser, All panels and Terminal can be maximized.',
          'error',
        )
      }
    },
    'rightPanel.close': () => {
      if (hasRightPanelController()) closeRightPanel()
      else closeWorkspaceRightPanel(input.ownerKey)
    },
    'rightPanel.allPanels': () => toggleRightPanelSurface('all-panels'),
    'rightPanel.projectActions': () => toggleRightPanelSurface('project-actions'),
    'rightPanel.files': () => toggleRightPanelSurface('files'),
    'rightPanel.resources': () => toggleRightPanelSurface('resources'),
  }
}

/** Mod+W closes the Right panel only while one is shown. */
export function rightPanelCloseIsActive(ownerKey: string) {
  return hasRightPanelController()
    ? useRightSidebarCoordinator.getState().activeClaim !== null
    : hasActiveWorkspaceRightPanel(ownerKey)
}
