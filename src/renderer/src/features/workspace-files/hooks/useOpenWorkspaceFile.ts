import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useChatStore } from '@/features/chat/state'

function routeSessionId(pathname: string) {
  if (!pathname.startsWith('/sessions/')) return null
  const [, segment, sessionId] = pathname.split('/')
  return segment === 'sessions' && sessionId ? sessionId : null
}

export function useOpenWorkspaceFile() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const activeSessionId = useChatStore((state) => state.activeSessionId)

  return (relativePath: string, line?: number | null) => {
    const sessionId = routeSessionId(pathname) ?? (activeSessionId ? String(activeSessionId) : null)
    const fileLine = line ?? undefined
    if (sessionId) {
      void navigate({
        to: '/sessions/$sessionId',
        params: { sessionId },
        search: (previous) => ({
          ...previous,
          diff: undefined,
          panel: 'file',
          filePath: relativePath,
          fileLine,
          sidePanelExtensionId: undefined,
          sidePanelId: undefined,
          sidePanelPackagePath: undefined,
          sidePanelContentHash: undefined,
        }),
      })
      return
    }
    void navigate({
      to: '/',
      search: {
        diff: undefined,
        panel: 'file',
        filePath: relativePath,
        fileLine,
      },
    })
  }
}
