import { useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { api } from '@/shared/lib/ipc'

const SESSION_PATH = /^\/sessions\/([^/]+)/

/** The Session a route shows, or null for Settings, a draft and every other page. */
export function sessionIdOfPath(pathname: string) {
  const encoded = SESSION_PATH.exec(pathname)?.[1]
  if (!encoded) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

function report(sessionId: string | null) {
  // One-way like the resource owner: Promise.resolve absorbs the diagnostic fallback when the
  // preload is unavailable, which already reports the failure to the console.
  void Promise.resolve()
    .then(() => api.setDesktopNotificationViewingSession(sessionId))
    .catch(() => undefined)
}

/**
 * Tell the desktop app which Session this window shows, so a notification about it stays quiet
 * while the window has focus (ADR 0062).
 */
export function useDesktopNotificationViewing() {
  const sessionId = useRouterState({ select: (state) => sessionIdOfPath(state.location.pathname) })
  useEffect(() => {
    report(sessionId)
    return () => report(null)
  }, [sessionId])
}
