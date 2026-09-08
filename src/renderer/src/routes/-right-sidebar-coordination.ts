import { match } from '@diegogbrisa/ts-match'
import { useEffect } from 'react'
import {
  DIFF_RIGHT_SIDEBAR_REQUEST,
  extensionRightSidebarRequest,
  SESSION_TREE_RIGHT_SIDEBAR_REQUEST,
  useRightSidebarCoordinator,
  workspaceFileRightSidebarRequest,
} from '@/shared/lib/right-sidebar-coordinator'
import type { RightSidebarPanel } from '@/shell'

interface ExtensionPanelIdentity {
  readonly extensionId: string
  readonly sidePanelId: string
  readonly packagePath?: string
  readonly contentHash?: string
}

interface WorkspaceFileIdentity {
  readonly path: string
  readonly line?: number | null
}

function coordinateRoutePanel(open: boolean, requestKey: string | null) {
  const coordinator = useRightSidebarCoordinator.getState()
  if (!open) {
    coordinator.releaseRoute()
    return
  }
  if (requestKey !== null) coordinator.claimRoute(requestKey)
}

export function coordinateDiffPanel(open: boolean) {
  coordinateRoutePanel(open, DIFF_RIGHT_SIDEBAR_REQUEST)
}

export function coordinateSessionTreePanel(open: boolean) {
  coordinateRoutePanel(open, SESSION_TREE_RIGHT_SIDEBAR_REQUEST)
}

export function coordinateExtensionPanel(open: boolean, target: ExtensionPanelIdentity) {
  coordinateRoutePanel(
    open,
    extensionRightSidebarRequest(
      target.extensionId,
      target.sidePanelId,
      target.packagePath,
      target.contentHash,
    ),
  )
}

export function coordinateWorkspaceFilePanel(open: boolean, target?: WorkspaceFileIdentity) {
  coordinateRoutePanel(
    open,
    target ? workspaceFileRightSidebarRequest(target.path, target.line ?? null) : null,
  )
}

export function routePanelRequestKey(
  panel: RightSidebarPanel,
  workspaceFile: { readonly path: string; readonly line: number | null } | null,
) {
  return match(panel)
    .with('diff', () => DIFF_RIGHT_SIDEBAR_REQUEST)
    .with('session-tree', () => SESSION_TREE_RIGHT_SIDEBAR_REQUEST)
    .with('file', () =>
      workspaceFile
        ? workspaceFileRightSidebarRequest(workspaceFile.path, workspaceFile.line)
        : null,
    )
    .with({ kind: 'extension-side-panel' }, (target) =>
      extensionRightSidebarRequest(
        target.extensionId,
        target.sidePanelId,
        target.packagePath,
        target.contentHash,
      ),
    )
    .exhaustive()
}

export function useRoutePanelClaim(requestKey: string | null, scopeKey: string | null) {
  const activeClaim = useRightSidebarCoordinator((state) => state.activeClaim)

  useEffect(() => {
    if (requestKey === null) return
    if (scopeKey !== null && scopeKey.length === 0) return
    useRightSidebarCoordinator.getState().claimRoute(requestKey)
    return () => useRightSidebarCoordinator.getState().releaseRoute(requestKey)
  }, [requestKey, scopeKey])

  return (
    requestKey !== null && activeClaim?.kind === 'route' && activeClaim.requestKey === requestKey
  )
}
