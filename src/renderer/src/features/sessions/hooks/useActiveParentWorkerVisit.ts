import type { SessionSummary } from '@shared/types/session'
import { useEffect, useRef } from 'react'
import { useChatStore } from '@/features/chat/state'
import { useSessionStatusStore } from '@/features/sessions/state/session-status-store'
import { useSessionStore } from '@/features/sessions/state/session-store'

interface SeenWorkerRunEnd {
  readonly sessionId: string
  readonly endedAt: number | undefined
}

function workersLastRunEndedAt(sessions: readonly SessionSummary[], sessionId: string) {
  return sessions.find((session) => String(session.id) === sessionId)?.lineage
    ?.workersLastRunEndedAt
}

/**
 * Done below means finished while the person was away (ADR 0065). A Worker Run that ends while its
 * parent is the Session on screen is seen, as the parent's own completion is, so the open parent
 * is marked visited when its catalog entry reports a later Worker Run end. Only a change while it
 * stays open counts, so marking the open Session unread is not undone.
 */
export function useActiveParentWorkerVisit() {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const sessions = useSessionStore((state) => state.sessions)
  const markVisited = useSessionStatusStore((state) => state.markVisited)
  const seen = useRef<SeenWorkerRunEnd | null>(null)

  useEffect(() => {
    if (activeSessionId === null) {
      seen.current = null
      return
    }
    const sessionId = String(activeSessionId)
    const endedAt = workersLastRunEndedAt(sessions, sessionId)
    const previous = seen.current
    seen.current = { sessionId, endedAt }
    if (previous?.sessionId !== sessionId || endedAt === undefined) return
    if (previous.endedAt !== undefined && previous.endedAt >= endedAt) return
    markVisited(activeSessionId)
  }, [activeSessionId, sessions, markVisited])
}
