import type { ConversationId } from '@shared/types/brand'
import { type SessionStatus, TERMINAL_STATUSES } from '@shared/types/session-status'
import { create } from 'zustand'

interface SessionStatusState {
  statuses: Map<ConversationId, SessionStatus>
  /** When a terminal status (completed/error) was recorded */
  completedAt: Map<ConversationId, number>
  /** When the user last visited (navigated to) a session */
  lastVisitedAt: Map<ConversationId, number>

  setStatus: (id: ConversationId, status: SessionStatus) => void
  clearStatus: (id: ConversationId) => void
  getStatus: (id: ConversationId) => SessionStatus
  markVisited: (id: ConversationId) => void
  markUnread: (id: ConversationId) => void
}

export const useSessionStatusStore = create<SessionStatusState>((set, get) => ({
  statuses: new Map<ConversationId, SessionStatus>(),
  completedAt: new Map<ConversationId, number>(),
  lastVisitedAt: new Map<ConversationId, number>(),

  setStatus(id: ConversationId, status: SessionStatus) {
    set((state) => {
      const next: Partial<SessionStatusState> = {}

      // Update statuses map
      if (state.statuses.get(id) !== status) {
        const nextStatuses = new Map(state.statuses)
        if (status === 'idle') {
          nextStatuses.delete(id)
        } else {
          nextStatuses.set(id, status)
        }
        next.statuses = nextStatuses
      }

      // Update completedAt based on status category
      const isTerminal = TERMINAL_STATUSES.has(status)
      if (isTerminal) {
        // Terminal -> record completion time
        const nextCompleted = new Map(state.completedAt)
        nextCompleted.set(id, Date.now())
        next.completedAt = nextCompleted
      }
      if (!isTerminal && state.completedAt.has(id)) {
        // Live or idle -> clear completion (session is active again or reset)
        const nextCompleted = new Map(state.completedAt)
        nextCompleted.delete(id)
        next.completedAt = nextCompleted
      }

      // If nothing changed, bail
      if (Object.keys(next).length === 0) return state
      return { ...state, ...next }
    })
  },

  clearStatus(id: ConversationId) {
    set((state) => {
      if (!state.statuses.has(id)) return state
      const next = new Map(state.statuses)
      next.delete(id)
      const nextCompleted = new Map(state.completedAt)
      nextCompleted.delete(id)
      return { statuses: next, completedAt: nextCompleted }
    })
  },

  getStatus(id: ConversationId): SessionStatus {
    return get().statuses.get(id) ?? 'idle'
  },

  markVisited(id: ConversationId) {
    set((state) => {
      const nextVisited = new Map(state.lastVisitedAt)
      nextVisited.set(id, Date.now())
      return { lastVisitedAt: nextVisited }
    })
  },

  markUnread(id: ConversationId) {
    set((state) => {
      const completed = state.completedAt.get(id) ?? Date.now()
      const nextVisited = new Map(state.lastVisitedAt)
      nextVisited.set(id, completed - 1)
      return { lastVisitedAt: nextVisited }
    })
  },
}))
