import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useChatStore } from '@/stores/chat-store'

interface DiffRouteNavigation {
  readonly diffOpen: boolean
  readonly isChatRoute: boolean
  readonly toggleDiff: () => void
  readonly closeDiff: () => void
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
  const diffOpen = useRouterState({ select: (state) => state.location.search.diff === 1 })
  const activeConversationId = useChatStore((state) => state.activeConversationId)
  const isChatRoute = isChatPath(pathname)
  const currentRouteSessionId = routeSessionId(pathname)
  const targetSessionId =
    currentRouteSessionId ?? (activeConversationId ? String(activeConversationId) : null)

  function setDiffOpen(open: boolean): void {
    if (!isChatRoute) {
      return
    }

    if (targetSessionId) {
      void navigate({
        to: '/sessions/$sessionId',
        params: { sessionId: targetSessionId },
        search: (previous) => ({ ...previous, diff: open ? 1 : undefined }),
      })
      return
    }

    void navigate({
      to: '/',
      search: (previous) => ({ ...previous, diff: open ? 1 : undefined }),
    })
  }

  return {
    diffOpen,
    isChatRoute,
    toggleDiff: () => setDiffOpen(!diffOpen),
    closeDiff: () => setDiffOpen(false),
  }
}
