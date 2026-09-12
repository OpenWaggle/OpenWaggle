import { terminalSidePanelLayoutKey, useTerminalStore } from '@/features/terminal'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { collectOwnerReconciliationErrors } from './workspace-owner-reconciliation'
import { useWorkspacePanelStore } from './workspace-panel-store'

function restoreTerminalSelection(ownerKey: string) {
  const state = useWorkspacePanelStore.getState()
  const group = state.groups[ownerKey]
  if (!group) return
  useWorkspacePanelStore.setState({
    groups: {
      ...state.groups,
      [ownerKey]: { ...group, activeSurface: { kind: 'terminal' }, panelOpen: true },
    },
  })
}

function claimRestoredTerminal(ownerKey: string, wasActive: boolean) {
  if (!wasActive) return
  const coordinator = useRightSidebarCoordinator.getState()
  const claim = coordinator.activeClaim
  if (claim && (claim.kind !== 'workspace' || claim.ownerKey !== ownerKey)) return
  const group = useWorkspacePanelStore.getState().groups[ownerKey]
  if (group?.activeSurface?.kind === 'terminal' && group.panelOpen) {
    coordinator.claimWorkspace(ownerKey)
  }
}

/** Restore the owner's retained surface independently of the currently opened Session. */
export function reconcileClosedBrowsers(ownerKey: string, closedIds: readonly string[]) {
  const closed = new Set(closedIds)
  const store = useWorkspacePanelStore.getState()
  const group = store.groups[ownerKey]
  const claim = useRightSidebarCoordinator.getState().activeClaim
  const wasActive = claim?.kind === 'workspace' && claim.ownerKey === ownerKey
  const sideGroup = useTerminalStore.getState().groups[terminalSidePanelLayoutKey(ownerKey)]
  const shouldRestoreTerminal =
    sideGroup?.panelOpen === true &&
    sideGroup.tabs.length > 0 &&
    group?.panelOpen === true &&
    group.activeSurface?.kind === 'browser' &&
    closed.has(group.activeSurface.previewId) &&
    group.browserTabs.every((tab) => closed.has(tab.id))
  return collectOwnerReconciliationErrors([
    () => {
      if (closedIds.length > 0) store.closeBrowsers(ownerKey, closedIds)
    },
    () => {
      if (shouldRestoreTerminal) restoreTerminalSelection(ownerKey)
    },
    () => {
      if (shouldRestoreTerminal) claimRestoredTerminal(ownerKey, wasActive)
    },
  ])
}
