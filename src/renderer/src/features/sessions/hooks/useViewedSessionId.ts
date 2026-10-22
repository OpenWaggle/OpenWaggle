import { useRouterState } from '@tanstack/react-router'

/**
 * The Session the route shows, or `null` on a new-session draft, Settings, Skills, or another
 * page that is not a Session. The active Session survives a visit to Settings; commands that act
 * on "the open Session", such as copying its link, follow the route instead (ADR 0056).
 */
export function useViewedSessionId(): string | null {
  return useRouterState({
    select: (state) => {
      const [, segment, sessionId] = state.location.pathname.split('/')
      return segment === 'sessions' && sessionId ? sessionId : null
    },
  })
}
