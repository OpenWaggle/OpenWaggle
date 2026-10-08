import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'

interface RouteState {
  readonly sessionId: SessionId | null
  readonly detail: SessionDetail | null
}

/** What the chat route renders: the selected Session and its detail as the chat store holds it. */
export function createRouteStore() {
  let state: RouteState = { sessionId: null, detail: null }
  const listeners = new Set<() => void>()
  const lastDetails = new Map<SessionId, SessionDetail>()
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get: () => state,
    /** The detail the chat store last held for the Session: what it shows until it refetches. */
    lastDetail: (sessionId: SessionId) => lastDetails.get(sessionId) ?? null,
    set(next: RouteState) {
      state = next
      if (next.sessionId && next.detail) lastDetails.set(next.sessionId, next.detail)
      for (const listener of [...listeners]) listener()
    },
  }
}

export const OTHER_SESSION_ID = SessionId('other-session')

/** Another Session the user can look at instead. */
export const OTHER_DETAIL: SessionDetail = {
  id: OTHER_SESSION_ID,
  title: 'Other',
  projectPath: '/tmp/project',
  createdAt: 1,
  updatedAt: 1,
  messages: [],
}
