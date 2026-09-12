import { useEffect } from 'react'
import {
  BrowserPreviewFloatingPanel,
  selectBrowserPreviewFloating,
  useBrowserPreviewFloatingStore,
} from '@/features/browser-preview'
import { useChat } from '@/features/chat/hooks'
import { useProject } from '@/features/sessions/hooks'
import { terminalOwnerContext } from '@/features/terminal'
import { api } from '@/shared/lib/ipc'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { useUIStore } from './ui-store'
import { confirmBrowserTabsClose } from './workspace-browser-close'
import type { WorkspacePanelSurface } from './workspace-panel-model'
import type { BrowserPreviewTabState } from './workspace-panel-store'
import { useWorkspacePanelStore } from './workspace-panel-store'

interface WorkspaceFloatingVisibilityInput {
  readonly activeClaim: { readonly kind: string; readonly ownerKey?: string } | null
  readonly activeSurface: WorkspacePanelSurface
  readonly ownerKey: string
  readonly panelOpen: boolean
  readonly previewId: string
}

export function shouldRenderWorkspaceFloatingPreview(input: WorkspaceFloatingVisibilityInput) {
  const samePreviewInPanel =
    input.panelOpen &&
    input.activeClaim?.kind === 'workspace' &&
    input.activeClaim.ownerKey === input.ownerKey &&
    input.activeSurface?.kind === 'browser' &&
    input.activeSurface.previewId === input.previewId
  return !samePreviewInPanel
}

async function closeFloatingBrowser(
  ownerKey: string,
  tab: BrowserPreviewTabState,
  onError: (message: string) => void,
) {
  try {
    if (!(await confirmBrowserTabsClose([tab]))) return
    await api.closeBrowserPreview(tab.id)
    useBrowserPreviewFloatingStore.getState().removePreview(ownerKey, tab.id)
    useWorkspacePanelStore.getState().closeBrowser(ownerKey, tab.id)
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Browser preview could not close.')
  }
}

type MaterializedWorkspaceBrowserTab = BrowserPreviewTabState & { readonly kind: 'preview' }

function isMaterializedTab(
  tab: BrowserPreviewTabState | undefined,
): tab is MaterializedWorkspaceBrowserTab {
  return tab?.kind === 'preview'
}

/** Renders the active Session's floating preview over chat, never over its duplicate panel view. */
export function WorkspaceBrowserFloatingPreview() {
  const { activeSession } = useChat()
  const { projectPath } = useProject()
  const ownerKey = terminalOwnerContext(activeSession, projectPath).ownerKey
  const floating = useBrowserPreviewFloatingStore((state) =>
    selectBrowserPreviewFloating(state.byOwnerKey, ownerKey),
  )
  const group = useWorkspacePanelStore((state) => state.groups[ownerKey])
  const activeClaim = useRightSidebarCoordinator((state) => state.activeClaim)
  const showToast = useUIStore((state) => state.showToast)
  const candidate = group?.browserTabs.find((tab) => tab.id === floating?.previewId)
  const tab = isMaterializedTab(candidate) ? candidate : undefined

  useEffect(() => {
    if (floating !== null && tab === undefined) {
      useBrowserPreviewFloatingStore.getState().removePreview(ownerKey, floating.previewId)
    }
  }, [floating, ownerKey, tab])

  if (floating === null || tab === undefined) return null
  if (
    !shouldRenderWorkspaceFloatingPreview({
      activeClaim,
      activeSurface: group?.activeSurface ?? null,
      ownerKey,
      panelOpen: group?.panelOpen ?? false,
      previewId: tab.id,
    })
  ) {
    return null
  }

  const onError = (message: string) => showToast(message, 'error')
  return (
    <BrowserPreviewFloatingPanel
      key={tab.id}
      tab={tab}
      onCloseBrowser={() => void closeFloatingBrowser(ownerKey, tab, onError)}
      onError={onError}
      onOpenInPanel={() => useWorkspacePanelStore.getState().showBrowser(ownerKey, tab.id)}
      onUpdate={(patch) => useWorkspacePanelStore.getState().updateBrowser(ownerKey, tab.id, patch)}
    />
  )
}
