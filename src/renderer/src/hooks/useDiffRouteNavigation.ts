import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useChatStore } from '@/stores/chat-store'
import { useUIStore } from '@/stores/ui-store'

type RightPanelMode = 'diff' | 'session-tree' | null

interface DiffRouteNavigation {
  readonly diffOpen: boolean
  readonly isChatRoute: boolean
  readonly rightPanel: RightPanelMode
  readonly sessionTreeOpen: boolean
  readonly toggleDiff: () => void
  readonly closeDiff: () => void
  readonly toggleSessionTree: () => void
  readonly closeSessionTree: () => void
}

function isChatPath(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/sessions/')
}

function routeSessionId(pathname: string): string | null {
  if (!pathname.startsWith('/sessions/')) {
    return null
  }

  const [, sessionsSegment, sessionId] = pathname.split('/')
  return sessionsSegment === 'sessions' && sessionId ? sessionId : null
}

export function useDiffRouteNavigation(): DiffRouteNavigation {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const rightPanel = useRouterState({
    select: (state) => {
      if (state.location.search.panel === 'session-tree') {
        return 'session-tree'
      }
      if (state.location.search.panel === 'diff' || state.location.search.diff === 1) {
        return 'diff'
      }
      return null
    },
  })
  const activeConversationId = useChatStore((state) => state.activeConversationId)
  const setLastRightSidebarPanel = useUIStore((state) => state.setLastRightSidebarPanel)
  const isChatRoute = isChatPath(pathname)
  const currentRouteSessionId = routeSessionId(pathname)
  const targetSessionId =
    currentRouteSessionId ?? (activeConversationId ? String(activeConversationId) : null)

  const diffOpen = rightPanel === 'diff'
  const sessionTreeOpen = rightPanel === 'session-tree'

  function setRightPanel(panel: RightPanelMode): void {
    if (!isChatRoute) {
      return
    }

    const panelToRemember = panel ?? rightPanel
    if (panelToRemember !== null) {
      setLastRightSidebarPanel(panelToRemember)
    }

    const panelSearchValue = panel ?? undefined

    if (targetSessionId) {
      void navigate({
        to: '/sessions/$sessionId',
        params: { sessionId: targetSessionId },
        search: (previous) => ({
          ...(currentRouteSessionId ? { branch: previous.branch, node: previous.node } : {}),
          diff: undefined,
          panel: panelSearchValue,
        }),
      })
      return
    }

    void navigate({
      to: '/',
      search: { diff: undefined, panel: panelSearchValue },
    })
  }

  function setDiffOpen(open: boolean): void {
    setRightPanel(open ? 'diff' : null)
  }

  function setSessionTreeOpen(open: boolean): void {
    setRightPanel(open ? 'session-tree' : null)
  }

  return {
    diffOpen,
    isChatRoute,
    rightPanel,
    sessionTreeOpen,
    toggleDiff: () => setDiffOpen(!diffOpen),
    closeDiff: () => setDiffOpen(false),
    toggleSessionTree: () => setSessionTreeOpen(!sessionTreeOpen),
    closeSessionTree: () => setSessionTreeOpen(false),
  }
}
