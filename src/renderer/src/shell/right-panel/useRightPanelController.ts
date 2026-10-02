import { match } from '@diegogbrisa/ts-match'
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import {
  parseExtensionRightPanelSurfaceId,
  type RightPanelSurfaceId,
  registerRightPanelController,
} from '@/shared/lib/right-panel-surfaces'
import {
  DIFF_RIGHT_SIDEBAR_REQUEST,
  extensionRightSidebarRequest,
  SESSION_TREE_RIGHT_SIDEBAR_REQUEST,
  useRightSidebarCoordinator,
  workspaceFileRightSidebarRequest,
} from '@/shared/lib/right-sidebar-coordinator'
import { EXTENSION_SIDE_PANEL_ROUTE_PANEL, useUIStore } from '../ui-store'
import { showWorkspaceBrowser } from '../workspace-panel-actions'
import { useWorkspacePanelStore } from '../workspace-panel-store'
import { sessionRightPanelMemory, useRightPanelRailStore } from './right-panel-rail-store'
import type { RightPanelModel } from './useRightPanelModel'
import { useRightPanelRouteNavigation } from './useRightPanelRouteNavigation'

const FILE_LOOKUP_LIMIT = 50
/** How long a Session waits for a remembered surface that is still loading before giving up. */
const RESTORE_WAIT_MS = 3000

async function existingWorkspaceFile(workingPath: string | null, path: string | null) {
  if (workingPath === null || path === null) return null
  try {
    const files = await api.searchWorkspaceFiles(workingPath, path, FILE_LOOKUP_LIMIT)
    return files.some((file) => file.path === path) ? path : null
  } catch {
    return null
  }
}

function useRouteFileTarget() {
  return useRouterState({
    select: (state) =>
      state.location.search.panel === 'file' && typeof state.location.search.filePath === 'string'
        ? state.location.search.filePath
        : null,
  })
}

function useRouteHasPanel() {
  return useRouterState({
    select: (state) =>
      state.location.search.panel !== undefined || state.location.search.diff === 1,
  })
}

/**
 * Bumps on every surface request and Session switch, so a slow Files lookup cannot override a
 * later choice or navigate back to the Session it started in.
 */
function useSurfaceRequests(sessionKey: string | null) {
  const surfaceRequest = useRef(0)
  useEffect(() => {
    surfaceRequest.current += 1
  }, [sessionKey])
  return surfaceRequest
}

function openExtensionSurface(input: {
  readonly id: RightPanelSurfaceId
  readonly model: RightPanelModel
  readonly route: ReturnType<typeof useRightPanelRouteNavigation>
  readonly hideWorkspacePanel: () => void
}) {
  const { id, model, route } = input
  const identity = parseExtensionRightPanelSurfaceId(id)
  const panel = model.extensionPanels.find((candidate) => candidate.id === id)
  if (identity === null || panel === undefined) return
  input.hideWorkspacePanel()
  route.open(
    {
      panel: EXTENSION_SIDE_PANEL_ROUTE_PANEL,
      sidePanelExtensionId: panel.extensionId,
      sidePanelId: panel.sidePanelId,
      sidePanelPackagePath: panel.packagePath,
      sidePanelContentHash: panel.contentHash,
    },
    extensionRightSidebarRequest(
      panel.extensionId,
      panel.sidePanelId,
      panel.packagePath,
      panel.contentHash,
    ),
  )
}

/**
 * Implements Right panel surface commands for the mounted chat context and keeps each
 * Session's panel memory (ADR 0043). Mounted once, beside the Panel rail.
 */
export function useRightPanelController(model: RightPanelModel, workingPath: string | null) {
  const route = useRightPanelRouteNavigation()
  const showToast = useUIStore((state) => state.showToast)
  const routeFilePath = useRouteFileTarget()
  const routeHasPanel = useRouteHasPanel()
  const { ownerKey, sessionKey, shown } = model
  const surfaceRequest = useSurfaceRequests(sessionKey)

  function hideWorkspacePanel() {
    if (useWorkspacePanelStore.getState().groups[ownerKey]?.panelOpen === true) {
      useWorkspacePanelStore.getState().hidePanel(ownerKey)
    }
  }

  /** Drops a route surface, including one covered by the guided action panel, from the URL. */
  function clearRoutePanel() {
    const claim = useRightSidebarCoordinator.getState().activeClaim
    const coveredRoute = claim?.kind === 'action-panel' && claim.previous?.kind === 'route'
    if (claim?.kind === 'route' || coveredRoute || routeHasPanel) route.close()
  }

  function closePanel() {
    const coordinator = useRightSidebarCoordinator.getState()
    if (coordinator.activeClaim?.kind === 'action-panel') coordinator.releaseActionPanel()
    if (useRightSidebarCoordinator.getState().activeClaim?.kind === 'route') route.close()
    hideWorkspacePanel()
  }

  function openFiles(request: number) {
    const remembered = sessionRightPanelMemory(sessionKey).lastFilePath
    // The check runs before anything closes, so switching to Files never flashes a closed panel.
    void existingWorkspaceFile(workingPath, remembered).then((filePath) => {
      if (request !== surfaceRequest.current) return
      hideWorkspacePanel()
      if (filePath === null) {
        route.open({ panel: 'file' }, workspaceFileRightSidebarRequest('', null))
        return
      }
      route.open({ panel: 'file', filePath }, workspaceFileRightSidebarRequest(filePath, null))
    })
  }

  function showSurface(id: RightPanelSurfaceId) {
    const entry = model.surfaces.find((surface) => surface.id === id)
    if (entry === undefined) return
    if (entry.disabledReason !== null) {
      showToast(entry.disabledReason)
      return
    }
    if (entry.extension !== null) useRightPanelRailStore.getState().acknowledge([id])
    surfaceRequest.current += 1
    const request = surfaceRequest.current
    match(id)
      .with('changes', () => {
        hideWorkspacePanel()
        route.open({ panel: 'diff' }, DIFF_RIGHT_SIDEBAR_REQUEST)
      })
      .with('session-tree', () => {
        hideWorkspacePanel()
        route.open({ panel: 'session-tree' }, SESSION_TREE_RIGHT_SIDEBAR_REQUEST)
      })
      .with('resources', () => {
        hideWorkspacePanel()
        route.open({ panel: 'resources', resourceView: 'sources' }, 'resources')
      })
      .with('files', () => openFiles(request))
      .with('browser', () => {
        clearRoutePanel()
        showWorkspaceBrowser(ownerKey)
      })
      .with('project-actions', () => {
        clearRoutePanel()
        useWorkspacePanelStore.getState().showIndexSurface(ownerKey, 'project-actions')
      })
      .with('all-panels', () => {
        clearRoutePanel()
        useRightPanelRailStore
          .getState()
          .acknowledge(model.extensionPanels.map((panel) => panel.id))
        useWorkspacePanelStore.getState().showIndexSurface(ownerKey, 'all-panels')
      })
      .otherwise(() => openExtensionSurface({ id, model, route, hideWorkspacePanel }))
  }

  function toggleSurface(id: RightPanelSurfaceId) {
    if (shown.open && shown.shown === id) {
      closePanel()
      return
    }
    showSurface(id)
  }

  function togglePanel() {
    if (shown.open) {
      closePanel()
      return
    }
    const rail = useRightPanelRailStore.getState()
    const remembered = sessionRightPanelMemory(sessionKey).surface ?? rail.lastSurface
    const target = model.surfaces.find(
      (surface) => surface.id === remembered && surface.disabledReason === null,
    )
    showSurface(target?.id ?? 'all-panels')
  }

  useEffect(() =>
    registerRightPanelController({ toggleSurface, showSurface, togglePanel, closePanel }),
  )

  useSessionPanelMemory({ model, routeFilePath, showSurface })
  return { toggleSurface, showSurface, togglePanel, closePanel }
}

/**
 * Records what each Session's panel shows and restores a route-backed surface when the Session
 * is reopened. Workspace surfaces already restore themselves per owner.
 */
function useSessionPanelMemory(input: {
  readonly model: RightPanelModel
  readonly routeFilePath: string | null
  readonly showSurface: (id: RightPanelSurfaceId) => void
}) {
  const { model, routeFilePath, showSurface } = input
  const routeSessionKey = useRouterState({
    select: (state) => {
      const [, segment, sessionId] = state.location.pathname.split('/')
      return segment === 'sessions' && sessionId ? sessionId : null
    },
  })
  // While navigation and the active Session disagree, claims belong to neither Session.
  const sessionKey =
    routeSessionKey === null || routeSessionKey === model.sessionKey ? model.sessionKey : null
  const { shown } = model
  const [restoredKey, setRestoredKey] = useState<string | null>(null)
  const memory = useRightPanelRailStore((state) =>
    sessionKey === null ? undefined : state.sessions[sessionKey],
  )
  const remembered =
    memory?.open === true && memory.surface !== undefined && memory.surface !== null
      ? model.surfaces.find((surface) => surface.id === memory.surface)
      : undefined
  // A remembered extension panel or Session Tree can need a moment to become available.
  const rememberedReady = remembered !== undefined && remembered.disabledReason === null
  const restoreSession = useEffectEvent((key: string, show: boolean) => {
    if (restoredKey === key) return
    const nothingShown = useRightSidebarCoordinator.getState().activeClaim === null
    const surface = sessionRightPanelMemory(key).surface
    if (show && nothingShown && surface !== null) showSurface(surface)
    setRestoredKey(key)
  })

  useEffect(() => {
    if (sessionKey === null) return
    const nothingToRestore = memory?.open !== true || memory.surface === null
    // Let the route and workspace claims of the newly selected Session settle first, and give a
    // remembered surface that is still loading a bounded wait before the Session's memory moves on.
    const ready = rememberedReady || nothingToRestore
    const timer = setTimeout(
      () => restoreSession(sessionKey, rememberedReady),
      ready ? 0 : RESTORE_WAIT_MS,
    )
    return () => clearTimeout(timer)
  }, [memory?.open, memory?.surface, rememberedReady, sessionKey])

  useEffect(() => {
    if (sessionKey === null || restoredKey !== sessionKey) return
    // The guided action panel is not this Session's choice; it must not overwrite its memory.
    if (shown.kind === 'action-panel') return
    useRightPanelRailStore.getState().rememberSession(sessionKey, {
      open: shown.open,
      ...(shown.highlight !== null ? { surface: shown.highlight } : {}),
      ...(routeFilePath !== null ? { lastFilePath: routeFilePath } : {}),
    })
  }, [restoredKey, routeFilePath, sessionKey, shown.highlight, shown.kind, shown.open])
}
