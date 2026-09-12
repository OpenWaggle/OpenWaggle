import { api } from '@/shared/lib/ipc'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { collectOwnerReconciliationErrors } from './workspace-owner-reconciliation'
import { EMPTY_WORKSPACE_PANEL_GROUP, lastBrowserSurface } from './workspace-panel-model'
import { useWorkspacePanelStore } from './workspace-panel-store'

const NATIVE_PREVIEW_CLOSE_ATTEMPTS = 2

async function closeNativePreview(previewId: string) {
  const errors: unknown[] = []
  for (let attempt = 0; attempt < NATIVE_PREVIEW_CLOSE_ATTEMPTS; attempt += 1) {
    try {
      await api.closeBrowserPreview(previewId)
      return []
    } catch (error) {
      errors.push(error)
    }
  }
  return errors.slice(0, 1)
}

/** Do not publish a new owner for an ID until its old native view is gone. */
export async function closeMigratingBrowserPreviews(previewIds: readonly string[]) {
  const failures = (await Promise.all(previewIds.map(closeNativePreview))).flat()
  if (failures.length === 0) return []
  const cause = failures[0]
  const detail = cause instanceof Error ? ` ${cause.message}` : ''
  return [
    new Error(
      `Browser tabs remain in the project draft. Terminal ownership moved to the Session.${detail}`,
      { cause },
    ),
  ]
}

/** Browser disposal failed; move only the side-terminal selection, not browser IDs or grants. */
export function retainDraftBrowsersAfterTerminalMigration(fromOwner: string, toOwner: string) {
  const store = useWorkspacePanelStore.getState()
  const source = store.groups[fromOwner]
  if (source?.activeSurface?.kind !== 'terminal') return
  const retainedBrowserSurface = lastBrowserSurface(source.browserTabs)
  const errors = collectOwnerReconciliationErrors([
    () =>
      useWorkspacePanelStore.setState({
        groups: {
          ...store.groups,
          [fromOwner]: {
            ...source,
            activeSurface: retainedBrowserSurface,
            panelOpen: source.panelOpen && retainedBrowserSurface !== null,
          },
          [toOwner]: {
            ...(store.groups[toOwner] ?? EMPTY_WORKSPACE_PANEL_GROUP),
            activeSurface: { kind: 'terminal' },
            panelOpen: source.panelOpen,
            maximized: source.maximized,
          },
        },
      }),
    () => {
      const coordinator = useRightSidebarCoordinator.getState()
      if (
        coordinator.activeClaim?.kind !== 'workspace' ||
        coordinator.activeClaim.ownerKey !== fromOwner
      )
        return
      if (source.panelOpen) coordinator.claimWorkspace(toOwner)
      else coordinator.releaseWorkspace(fromOwner)
    },
  ])
  if (errors.length > 0) throw errors[0]
}
