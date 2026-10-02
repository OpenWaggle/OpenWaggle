import type { SessionId } from '@shared/types/brand'
import { mergeSummary, toSummary } from './chat-store-helpers'
import type { ChatState } from './chat-store-types'

type ChatSet = (partial: (state: ChatState) => Partial<ChatState>) => void

/**
 * Patch the title in place. A title change keeps the Session's `updatedAt`, because recency means
 * recent work and a rename must never move a Session in the sidebar (ADR 0043).
 */
export function applySessionTitle(id: SessionId, title: string, set: ChatSet) {
  set((state) => {
    const existing = state.sessionById.get(id)
    if (!existing) {
      const summary = state.sessions.find((item) => item.id === id)
      if (summary) {
        return { sessions: mergeSummary(state.sessions, { ...summary, title }) }
      }
      const now = Date.now()
      return {
        sessions: mergeSummary(state.sessions, {
          id,
          title,
          projectPath: null,
          messageCount: 1,
          createdAt: now,
          updatedAt: now,
        }),
      }
    }

    const session = { ...existing, title }
    const sessionById = new Map(state.sessionById)
    sessionById.set(id, session)
    return {
      sessionById,
      sessions: mergeSummary(state.sessions, toSummary(session)),
      activeSession: state.activeSessionId === id ? session : state.activeSession,
    }
  })
}
