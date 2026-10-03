import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import type { EXTENSION_SIDE_PANEL_ROUTE_PANEL } from '../ui-store'

/** Route search fields owned by route-backed Right panel surfaces. */
export interface RightPanelRouteSearch {
  readonly panel?:
    | 'change-request'
    | 'diff'
    | 'file'
    | 'resources'
    | 'session-tree'
    | typeof EXTENSION_SIDE_PANEL_ROUTE_PANEL
  readonly filePath?: string
  readonly fileLine?: number
  readonly resourceView?: 'sources' | 'outputs'
  readonly resourceId?: string
  readonly sidePanelExtensionId?: string
  readonly sidePanelId?: string
  readonly sidePanelPackagePath?: string
  readonly sidePanelContentHash?: string
}

const CLEARED_ROUTE_PANEL = {
  diff: undefined,
  panel: undefined,
  filePath: undefined,
  fileLine: undefined,
  resourceView: undefined,
  resourceId: undefined,
  sidePanelExtensionId: undefined,
  sidePanelId: undefined,
  sidePanelPackagePath: undefined,
  sidePanelContentHash: undefined,
  changeRequestUrl: undefined,
  changeRequestSessionId: undefined,
} as const

function routeSessionId(pathname: string) {
  const [, segment, sessionId] = pathname.split('/')
  return segment === 'sessions' && sessionId ? sessionId : null
}

export function isRightPanelChatPath(pathname: string) {
  return pathname === '/' || pathname.startsWith('/sessions/')
}

/**
 * Opens and closes route-backed surfaces (Changes, Session Tree, Resources, Files and extension
 * panels) on the current chat route, claiming the right side first so it wins over a workspace
 * surface, exactly as the old header toggles did.
 */
export function useRightPanelRouteNavigation() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const sessionId = routeSessionId(pathname)
  const isChatRoute = isRightPanelChatPath(pathname)

  function setRouteSearch(patch: RightPanelRouteSearch) {
    if (!isChatRoute) return
    const search = { ...CLEARED_ROUTE_PANEL, ...patch }
    if (sessionId) {
      void navigate({
        to: '/sessions/$sessionId',
        params: { sessionId },
        search: (previous) => ({ branch: previous.branch, node: previous.node, ...search }),
      })
      return
    }
    void navigate({ to: '/', search })
  }

  return {
    isChatRoute,
    open(patch: RightPanelRouteSearch, requestKey: string) {
      useRightSidebarCoordinator.getState().claimRoute(requestKey)
      setRouteSearch(patch)
    },
    close() {
      useRightSidebarCoordinator.getState().releaseRoute()
      setRouteSearch({})
    },
  }
}
