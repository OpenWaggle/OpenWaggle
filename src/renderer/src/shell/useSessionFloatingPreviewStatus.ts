import { useBrowserPreviewFloatingStore } from '@/features/browser-preview'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { useWorkspacePanelStore } from './workspace-panel-store'

/** Floating native surfaces reserve the Session's overlay space without changing chat width. */
export function useSessionFloatingPreviewStatus(sessionId: string | null) {
  const previewId = useBrowserPreviewFloatingStore((state) =>
    sessionId ? state.byOwnerKey[sessionId]?.previewId : undefined,
  )
  const group = useWorkspacePanelStore((state) => (sessionId ? state.groups[sessionId] : undefined))
  const activeClaim = useRightSidebarCoordinator((state) => state.activeClaim)
  const materialized =
    previewId !== undefined &&
    group?.browserTabs.some((tab) => tab.id === previewId && tab.kind === 'preview')
  const docked =
    group?.panelOpen &&
    activeClaim?.kind === 'workspace' &&
    activeClaim.ownerKey === sessionId &&
    group.activeSurface?.kind === 'browser' &&
    group.activeSurface.previewId === previewId
  return Boolean(materialized && !docked)
}
