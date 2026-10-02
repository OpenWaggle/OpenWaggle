import { match } from '@diegogbrisa/ts-match'
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useState } from 'react'
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

/**
 * Implements Right panel surface commands for the mounted chat context and keeps each
 * Session's panel memory (ADR 0043). Mounted once, beside the Panel rail.
 */
export function useRightPanelController(model: RightPanelModel, workingPath: string | null) {
  const route = useRightPanelRouteNavigation()
  const showToast = useUIStore((state) => state.showToast)
  const routeFilePath = useRouteFileTarget()
  const { ownerKey, sessionKey, shown } = model

  function hideWorkspacePanel() {
    if (useWorkspacePanelStore.getState().groups[ownerKey]?.panelOpen === true) {
      useWorkspacePanelStore.getState().hidePanel(ownerKey)
    }
  }

  function clearRoutePanel() {
    if (useRightSidebarCoordinator.getState().activeClaim?.kind === 'route') route.close()
  }

  function closePanel() {
    const coordinator = useRightSidebarCoordinator.getState()
    if (coordinator.activeClaim?.kind === 'action-panel') coordinator.releaseActionPanel()
    if (useRightSidebarCoordinator.getState().activeClaim?.kind === 'route') route.close()
    hideWorkspacePanel()
  }

  function openFiles() {
    const remembered = sessionRightPanelMemory(sessionKey).lastFilePath
    hideWorkspacePanel()
    void existingWorkspaceFile(workingPath, remembered).then((filePath) => {
      if (filePath === null) {
        route.open({ panel: 'file' }, workspaceFileRightSidebarRequest('', null))
        return
      }
      route.open({ panel: 'file', filePath }, workspaceFileRightSidebarRequest(filePath, null))
    })
  }

  function openExtension(id: RightPanelSurfaceId) {
    const identity = parseExtensionRightPanelSurfaceId(id)
    const panel = model.extensionPanels.find((candidate) => candidate.id === id)
    if (identity === null || panel === undefined) return
    hideWorkspacePanel()
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

  function showSurface(id: RightPanelSurfaceId) {
    const entry = model.surfaces.find((surface) => surface.id === id)
    if (entry === undefined) return
    if (entry.disabledReason !== null) {
      showToast(entry.disabledReason)
      return
    }
    if (entry.extension !== null) useRightPanelRailStore.getState().acknowledge([id])
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
      .with('files', openFiles)
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
      .otherwise(() => openExtension(id))
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
  // Restore once per Session switch, not whenever the surface list re-renders.
  const restoreSession = useEffectEvent((key: string) => {
    const memory = sessionRightPanelMemory(key)
    const nothingShown = useRightSidebarCoordinator.getState().activeClaim === null
    if (memory.open && memory.surface !== null && nothingShown) showSurface(memory.surface)
    setRestoredKey(key)
  })

  useEffect(() => {
    if (sessionKey === null) return
    // Let the route and workspace claims of the newly selected Session settle first.
    const timer = setTimeout(() => restoreSession(sessionKey))
    return () => clearTimeout(timer)
  }, [sessionKey])

  useEffect(() => {
    if (sessionKey === null || restoredKey !== sessionKey) return
    useRightPanelRailStore.getState().rememberSession(sessionKey, {
      open: shown.open,
      ...(shown.highlight !== null ? { surface: shown.highlight } : {}),
      ...(routeFilePath !== null ? { lastFilePath: routeFilePath } : {}),
    })
  }, [restoredKey, routeFilePath, sessionKey, shown.highlight, shown.open])
}
